-- ─────────────────────────────────────────────────────────────────────────────
-- Tally Ledger Reconciliation
--
--   Problem
--     The Tally sync agent writes voucher rows with (party_ledger, amount, dr_cr)
--     but often leaves `line_items = []`. For contra / journal vouchers whose
--     party_ledger is not the ledger we are drilling into (e.g. a receipt
--     voucher with party = "Bank" that credits a customer), the current
--     drill-down query cannot see the customer's leg — so the computed closing
--     balance diverges from the TB closing that Tally itself reports.
--
--   Fix strategy
--     1.  New RPC `get_ledger_reconciliation` — the authoritative per-ledger
--         reconciliation. Returns opening, debit, credit, derived-closing,
--         tally-closing and the variance. Combines BOTH sources:
--           a) vouchers where party_ledger = target
--           b) line_items entries where ledger_name = target
--         de-duplicated by voucher id so nothing is double-counted.
--
--     2.  New RPC `refresh_tb_period_totals` — post-sync hook.  Fills
--         `tally_trial_balance.debit_amount / credit_amount` from the
--         reconciled voucher data.  Safe to run repeatedly.
--
--     3.  Upgraded `get_ledger_vouchers` RPC: emit per-voucher
--         `this_amount` / `this_dr_cr` so the frontend no longer has to pick
--         "the first matching line_item" (which under-counts vouchers with
--         multiple legs on the same ledger).
--
--   Accounting convention
--     The sync agent stores `dr_cr` inverted relative to accounting convention
--     (Tally-UI side, not book side).  The RPCs normalise with a `flip`
--     helper so downstream code sees proper Dr/Cr.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._tally_flip(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p = 'Dr' THEN 'Cr' WHEN p = 'Cr' THEN 'Dr' ELSE p END;
$$;

-- ── 1. Upgraded ledger-vouchers RPC ─────────────────────────────────────────
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
    -- Sum ALL line_items matching the target ledger, post-flip
    SELECT b.id,
           SUM(CASE WHEN public._tally_flip(e->>'dr_cr') = 'Dr'
                    THEN COALESCE((e->>'amount')::numeric, 0) ELSE 0 END) AS li_dr,
           SUM(CASE WHEN public._tally_flip(e->>'dr_cr') = 'Cr'
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
         -- this_amount / this_dr_cr: prefer line_items aggregate, fall back
         -- to the top-level voucher amount when line_items don't include
         -- the target ledger but party_ledger matches.
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
             THEN public._tally_flip(b.dr_cr)
           ELSE 'Dr'
         END AS this_dr_cr
    FROM base b
    LEFT JOIN legs ON legs.id = b.id
   ORDER BY b.voucher_date, b.voucher_number;
$$;

GRANT EXECUTE ON FUNCTION public.get_ledger_vouchers(uuid, text) TO authenticated, service_role;

-- ── 2. Reconciliation RPC ────────────────────────────────────────────────────
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
  v_open      numeric := 0;
  v_open_t    text    := 'Dr';
  v_close_tb  numeric := 0;
  v_close_tb_t text   := 'Dr';
  v_dr        numeric := 0;
  v_cr        numeric := 0;
  v_n         integer := 0;
  v_derived   numeric := 0;
  v_derived_t text;
BEGIN
  -- TB authoritative figures (remember: sync stores Dr/Cr inverted)
  SELECT COALESCE(tb.opening_balance, 0),
         public._tally_flip(COALESCE(tb.opening_type, 'Dr')),
         COALESCE(tb.closing_balance, 0),
         public._tally_flip(COALESCE(tb.balance_type, 'Dr'))
    INTO v_open, v_open_t, v_close_tb, v_close_tb_t
    FROM public.tally_trial_balance tb
   WHERE tb.engagement_id = p_engagement_id
     AND tb.ledger_name   = p_ledger_name
   LIMIT 1;

  -- Derive Dr/Cr totals from vouchers (de-dup by voucher id)
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
           SUM(CASE WHEN public._tally_flip(e->>'dr_cr')='Dr'
                    THEN COALESCE((e->>'amount')::numeric,0) ELSE 0 END) AS li_dr,
           SUM(CASE WHEN public._tally_flip(e->>'dr_cr')='Cr'
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
               WHEN b.party_ledger = p_ledger_name AND public._tally_flip(b.dr_cr) = 'Dr'
                    THEN COALESCE(b.amount, 0)
               ELSE 0 END),
         SUM(CASE
               WHEN COALESCE(legs.has_leg,0) = 1 AND (legs.li_dr + legs.li_cr) > 0
                    THEN legs.li_cr
               WHEN b.party_ledger = p_ledger_name AND public._tally_flip(b.dr_cr) = 'Cr'
                    THEN COALESCE(b.amount, 0)
               ELSE 0 END)
    INTO v_n, v_dr, v_cr
    FROM base b
    LEFT JOIN legs ON legs.id = b.id;

  v_dr := COALESCE(v_dr, 0);
  v_cr := COALESCE(v_cr, 0);

  -- Compute derived closing in signed space (Dr positive)
  v_derived := (CASE WHEN v_open_t = 'Dr' THEN v_open ELSE -v_open END)
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
  -- Signed variance in Dr-positive space
  variance := v_derived
            - (CASE WHEN v_close_tb_t = 'Dr' THEN v_close_tb ELSE -v_close_tb END);
  reconciled := abs(variance) < 1;   -- within ₹1 rounding
  voucher_count := v_n;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ledger_reconciliation(uuid, text) TO authenticated, service_role;

-- ── 3. Bulk reconciliation for an engagement (dashboard) ────────────────────
CREATE OR REPLACE FUNCTION public.list_ledger_variances(
  p_engagement_id uuid
)
RETURNS TABLE(
  ledger_name       text,
  tally_closing     numeric,
  tally_closing_type text,
  derived_closing   numeric,
  derived_closing_type text,
  variance          numeric,
  voucher_count     integer
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT l.ledger_name,
         r.tally_closing,
         r.tally_closing_type,
         r.derived_closing,
         r.derived_closing_type,
         r.variance,
         r.voucher_count
    FROM (
       SELECT DISTINCT ledger_name
         FROM public.tally_trial_balance
        WHERE engagement_id = p_engagement_id
    ) l
    CROSS JOIN LATERAL public.get_ledger_reconciliation(p_engagement_id, l.ledger_name) r
   WHERE abs(r.variance) >= 1
   ORDER BY abs(r.variance) DESC
   LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION public.list_ledger_variances(uuid) TO authenticated, service_role;

-- ── 4. Refresh period totals on the TB (post-sync hook) ─────────────────────
-- Populates tally_trial_balance.debit_amount / credit_amount from reconciled
-- voucher data, so downstream reports don't see 0.00 when the agent omits
-- period totals.
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
           public._tally_flip(COALESCE(e->>'dr_cr', v.dr_cr)) AS flipped
      FROM public.tally_vouchers v
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(v.line_items,'[]'::jsonb)) e ON true
     WHERE v.engagement_id = p_engagement_id
  ),
  -- De-dup: if a voucher has line_items, use them; otherwise use party_ledger.
  picked AS (
    SELECT vid, eid, ledger_name, amt, flipped
      FROM all_legs
     WHERE ledger_name IS NOT NULL
  ),
  sums AS (
    SELECT ledger_name,
           SUM(CASE WHEN flipped = 'Dr' THEN amt ELSE 0 END) AS dr,
           SUM(CASE WHEN flipped = 'Cr' THEN amt ELSE 0 END) AS cr
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
