-- ─────────────────────────────────────────────────────────────────────────────
-- Remove _tally_flip double-inversion bug.
--
--   Background
--     Migration 20260420190000 added `_tally_flip()` to get_ledger_vouchers,
--     get_ledger_reconciliation and refresh_tb_period_totals on the premise
--     that "the sync agent stores dr_cr inverted relative to accounting
--     convention." That premise is false: the agent stores dr_cr in the
--     correct Tally convention (verified — tally_trial_balance.debit_amount
--     for 'Jay Bahuchar Traders Serisa' = 6,24,250 which matches the Debit
--     column total in Tally Prime's Ledger Vouchers view exactly).
--
--     The spurious flip caused `get_ledger_reconciliation` to return
--     `opening_type` and `tally_closing_type` with the wrong sign, which
--     then made `derived_closing` come out on the wrong side of zero by
--     exactly `2 * |opening|`, producing a variance banner on every ledger
--     with a non-zero opening.
--
--   Fix
--     Replace all three RPCs so they return the stored dr_cr/type values
--     verbatim. Keep `_tally_flip` as a no-op-safe helper in case any
--     external caller references it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. get_ledger_vouchers — remove flips ───────────────────────────────────
DROP FUNCTION IF EXISTS public.get_ledger_vouchers(uuid, text);

CREATE OR REPLACE FUNCTION public.get_ledger_vouchers(
  p_engagement_id uuid,
  p_ledger_name   text
)
RETURNS TABLE(
  id             uuid,
  voucher_date   date,
  voucher_type   text,
  voucher_number text,
  narration      text,
  line_items     jsonb,
  party_ledger   text,
  amount         numeric,
  dr_cr          text,
  this_amount    numeric,
  this_dr_cr     text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH base AS (
    SELECT v.*
      FROM public.tally_vouchers v
     WHERE v.engagement_id = p_engagement_id
       AND (
         v.party_ledger = p_ledger_name
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(v.line_items,'[]'::jsonb)) e
            WHERE e->>'ledger_name' = p_ledger_name
         )
       )
  ),
  legs AS (
    SELECT b.id,
           SUM(CASE WHEN (e->>'dr_cr') = 'Dr'
                    THEN COALESCE((e->>'amount')::numeric, 0) ELSE 0 END) AS li_dr,
           SUM(CASE WHEN (e->>'dr_cr') = 'Cr'
                    THEN COALESCE((e->>'amount')::numeric, 0) ELSE 0 END) AS li_cr
      FROM base b
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(b.line_items,'[]'::jsonb)) e
             ON e->>'ledger_name' = p_ledger_name
     GROUP BY b.id
  )
  SELECT b.id,
         b.voucher_date,
         b.voucher_type,
         b.voucher_number,
         b.narration,
         COALESCE(b.line_items, '[]'::jsonb),
         b.party_ledger,
         b.amount,
         b.dr_cr,
         CASE
           WHEN COALESCE(legs.li_dr, 0) + COALESCE(legs.li_cr, 0) > 0
             THEN GREATEST(legs.li_dr, legs.li_cr)
           WHEN b.party_ledger = p_ledger_name
             THEN COALESCE(b.amount, 0)
           ELSE 0
         END AS this_amount,
         CASE
           WHEN COALESCE(legs.li_dr, 0) + COALESCE(legs.li_cr, 0) > 0
             THEN CASE WHEN legs.li_dr >= legs.li_cr THEN 'Dr' ELSE 'Cr' END
           WHEN b.party_ledger = p_ledger_name
             THEN b.dr_cr
           ELSE 'Dr'
         END AS this_dr_cr
    FROM base b
    LEFT JOIN legs ON legs.id = b.id
   ORDER BY b.voucher_date, b.voucher_number;
$$;

GRANT EXECUTE ON FUNCTION public.get_ledger_vouchers(uuid, text) TO authenticated, service_role;

-- ── 2. get_ledger_reconciliation — remove flips ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_ledger_reconciliation(
  p_engagement_id uuid,
  p_ledger_name   text
)
RETURNS TABLE(
  opening_balance       numeric,
  opening_type          text,
  debit_total           numeric,
  credit_total          numeric,
  derived_closing       numeric,
  derived_closing_type  text,
  tally_closing         numeric,
  tally_closing_type    text,
  variance              numeric,
  reconciled            boolean,
  voucher_count         integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_open       numeric := 0;
  v_open_t     text    := 'Dr';
  v_close_tb   numeric := 0;
  v_close_tb_t text    := 'Dr';
  v_dr         numeric := 0;
  v_cr         numeric := 0;
  v_n          integer := 0;
  v_derived    numeric := 0;
  v_derived_t  text;
BEGIN
  SELECT COALESCE(tb.opening_balance, 0),
         COALESCE(tb.opening_type, 'Dr'),
         COALESCE(tb.closing_balance, 0),
         COALESCE(tb.balance_type, 'Dr')
    INTO v_open, v_open_t, v_close_tb, v_close_tb_t
    FROM public.tally_trial_balance tb
   WHERE tb.engagement_id = p_engagement_id
     AND tb.ledger_name   = p_ledger_name
   LIMIT 1;

  WITH base AS (
    SELECT v.id, v.party_ledger, v.amount, v.dr_cr, v.line_items
      FROM public.tally_vouchers v
     WHERE v.engagement_id = p_engagement_id
       AND (
         v.party_ledger = p_ledger_name
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(v.line_items,'[]'::jsonb)) e
            WHERE e->>'ledger_name' = p_ledger_name
         )
       )
  ),
  legs AS (
    SELECT b.id,
           SUM(CASE WHEN (e->>'dr_cr')='Dr'
                    THEN COALESCE((e->>'amount')::numeric,0) ELSE 0 END) AS li_dr,
           SUM(CASE WHEN (e->>'dr_cr')='Cr'
                    THEN COALESCE((e->>'amount')::numeric,0) ELSE 0 END) AS li_cr,
           MAX(1) AS has_leg
      FROM base b
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(b.line_items,'[]'::jsonb)) e
             ON e->>'ledger_name' = p_ledger_name
     GROUP BY b.id
  )
  SELECT COUNT(*)::int,
         SUM(CASE
               WHEN COALESCE(legs.has_leg,0) = 1 AND (legs.li_dr + legs.li_cr) > 0
                    THEN legs.li_dr
               WHEN b.party_ledger = p_ledger_name AND b.dr_cr = 'Dr'
                    THEN COALESCE(b.amount, 0)
               ELSE 0 END),
         SUM(CASE
               WHEN COALESCE(legs.has_leg,0) = 1 AND (legs.li_dr + legs.li_cr) > 0
                    THEN legs.li_cr
               WHEN b.party_ledger = p_ledger_name AND b.dr_cr = 'Cr'
                    THEN COALESCE(b.amount, 0)
               ELSE 0 END)
    INTO v_n, v_dr, v_cr
    FROM base b
    LEFT JOIN legs ON legs.id = b.id;

  v_dr := COALESCE(v_dr, 0);
  v_cr := COALESCE(v_cr, 0);

  v_derived   := (CASE WHEN v_open_t = 'Dr' THEN v_open ELSE -v_open END)
               + v_dr - v_cr;
  v_derived_t := CASE WHEN v_derived >= 0 THEN 'Dr' ELSE 'Cr' END;

  opening_balance      := v_open;
  opening_type         := v_open_t;
  debit_total          := v_dr;
  credit_total         := v_cr;
  derived_closing      := abs(v_derived);
  derived_closing_type := v_derived_t;
  tally_closing        := v_close_tb;
  tally_closing_type   := v_close_tb_t;
  variance := v_derived
            - (CASE WHEN v_close_tb_t = 'Dr' THEN v_close_tb ELSE -v_close_tb END);
  reconciled := abs(variance) < 1;
  voucher_count := v_n;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ledger_reconciliation(uuid, text) TO authenticated, service_role;

-- ── 3. refresh_tb_period_totals — remove flip ───────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_tb_period_totals(
  p_engagement_id uuid
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH all_legs AS (
    SELECT v.id AS vid, p_engagement_id AS eid,
           COALESCE(e->>'ledger_name', v.party_ledger) AS ledger_name,
           COALESCE((e->>'amount')::numeric, v.amount) AS amt,
           COALESCE(e->>'dr_cr', v.dr_cr) AS side
      FROM public.tally_vouchers v
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(v.line_items,'[]'::jsonb)) e ON true
     WHERE v.engagement_id = p_engagement_id
  ),
  picked AS (
    SELECT vid, eid, ledger_name, amt, side
      FROM all_legs
     WHERE ledger_name IS NOT NULL
  ),
  sums AS (
    SELECT ledger_name,
           SUM(CASE WHEN side = 'Dr' THEN amt ELSE 0 END) AS dr,
           SUM(CASE WHEN side = 'Cr' THEN amt ELSE 0 END) AS cr
      FROM picked
     GROUP BY ledger_name
  )
  UPDATE public.tally_trial_balance t
     SET debit_amount  = s.dr,
         credit_amount = s.cr
    FROM sums s
   WHERE t.engagement_id = p_engagement_id
     AND t.ledger_name   = s.ledger_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_tb_period_totals(uuid) TO authenticated, service_role;
