/* ─────────────────────────────────────────────────────────────────────────────
   Stage-3 override memory.

   tds_tally_results is wiped on every ledger import (a fresh import invalidates
   the prior comparison), and a Genius re-import recreates every deductee with a
   NEW id — so an override keyed by result id or office_deductee_id was lost each
   time and the checker had to override the same records again (Sarkhej Motor
   Transport, 26Q Q2 FY 2026-27: sixteen overrides, repeated per re-import).

   This table remembers each override decision by the record's VALUES (party,
   date, TDS/credit, section) and its verdict, so a later run re-applies it to
   the same record with the same verdict whatever its ids are now. Scoped to one
   filing: a decision about this quarter's record never leaks into another.

   Idempotent; block comments only (applied by collapsing to one line).
   ───────────────────────────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.tds_override_memory (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id       uuid        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  firm_id         uuid        NOT NULL,
  stage           text        NOT NULL DEFAULT 'tally',
  record_key      text        NOT NULL,
  result          text        NOT NULL,
  override_reason text,
  overridden_by   uuid,
  overridden_at   timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_override_memory_filing ON public.tds_override_memory (filing_id, stage);

ALTER TABLE public.tds_override_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_tds_override_memory ON public.tds_override_memory;
CREATE POLICY service_role_all_tds_override_memory ON public.tds_override_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS auth_firm_tds_override_memory ON public.tds_override_memory;
CREATE POLICY auth_firm_tds_override_memory ON public.tds_override_memory FOR ALL TO authenticated USING (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())) WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tds_override_memory TO authenticated;

/* Backfill: remember every override that exists today, keyed exactly as
   overrideMemoryKey() in src/lib/tds/tallyRecon.ts builds it. */
INSERT INTO public.tds_override_memory (filing_id, firm_id, stage, record_key, result, override_reason, overridden_by, overridden_at)
SELECT r.filing_id, r.firm_id, 'tally',
  CASE WHEN r.office_deductee_id IS NOT NULL OR r.office_name IS NOT NULL
    THEN 'o|' || lower(regexp_replace(coalesce(r.office_name, ''), '[^A-Za-z0-9]+', '', 'g')) || '|' || coalesce(r.office_date, '') || '|' || coalesce(trim_scale(r.office_tds)::text, '')
    ELSE 'l|' || lower(regexp_replace(coalesce(r.tally_party, ''), '[^A-Za-z0-9]+', '', 'g')) || '|' || coalesce(r.tally_date, '') || '|' || coalesce(trim_scale(r.tally_credit)::text, '')
  END,
  r.result, r.override_reason, r.overridden_by, coalesce(r.overridden_at, now())
FROM public.tds_tally_results r
WHERE r.overridden
  AND NOT EXISTS (SELECT 1 FROM public.tds_override_memory m WHERE m.filing_id = r.filing_id AND m.stage = 'tally');
