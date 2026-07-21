/* ─────────────────────────────────────────────────────────────────────────────
   Stage-3 · Tally Reconciliation — atomic result replacement.

   runAudit() (src/components/tds/TdsTallyRecon.tsx) recomputes a filing's WHOLE
   reconciliation and replaces tds_tally_results wholesale on every run. Doing
   that as two separate client round trips (INSERT the new rows, THEN DELETE
   the prior ones) is not atomic: if two runAudit() calls overlap for the same
   filing — two browser tabs, or a user re-validating while a mapping-triggered
   re-run from a moment ago is still in flight — both can insert their own full
   row set before either deletes the other's, leaving duplicate result rows for
   the same office/ledger records (exactly the "counted twice" failure a
   reconciliation tool must never allow).

   This function performs the delete-then-insert inside ONE transaction (a
   single RPC call is one statement to PostgREST, hence one transaction), so
   concurrent calls serialize on Postgres's normal row locking instead of
   racing: whichever call's transaction commits LAST simply becomes the final,
   consistent state — nothing from a superseded run can persist alongside it.

   SECURITY INVOKER (the default) is deliberate, not an oversight: it makes the
   DELETE/INSERT go through the EXACT SAME RLS policies
   (auth_firm_tds_tally_results, firm_id = caller's own firm) that a direct
   client-side .insert()/.delete() already goes through today — no new
   authorization logic to get wrong, no privilege escalation, identical
   security posture to the two-call version it replaces. */

CREATE OR REPLACE FUNCTION public.replace_tally_results(p_filing_id uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.tds_tally_results WHERE filing_id = p_filing_id;

  INSERT INTO public.tds_tally_results (
    filing_id, batch_id, firm_id, quarter, office_deductee_id,
    office_name, office_date, office_amount, office_tds, office_section,
    tally_row_index, tally_party, tally_date, tally_credit,
    result, amount_basis, reason, confidence, mapped,
    overridden, override_reason, overridden_by, overridden_at
  )
  SELECT
    p_filing_id,
    (r->>'batch_id')::uuid,
    (r->>'firm_id')::uuid,
    r->>'quarter',
    (r->>'office_deductee_id')::uuid,
    r->>'office_name',
    r->>'office_date',
    (r->>'office_amount')::numeric,
    (r->>'office_tds')::numeric,
    r->>'office_section',
    (r->>'tally_row_index')::integer,
    r->>'tally_party',
    r->>'tally_date',
    (r->>'tally_credit')::numeric,
    r->>'result',
    r->>'amount_basis',
    r->>'reason',
    (r->>'confidence')::integer,
    coalesce((r->>'mapped')::boolean, false),
    coalesce((r->>'overridden')::boolean, false),
    r->>'override_reason',
    (r->>'overridden_by')::uuid,
    (r->>'overridden_at')::timestamptz
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$;
