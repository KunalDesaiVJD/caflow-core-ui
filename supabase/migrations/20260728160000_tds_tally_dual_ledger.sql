-- Stage-3: 24Q dual-ledger reconciliation (Salary/Remuneration ledger + TDS
-- Deducted ledger, reconciled SEPARATELY against Office Data's own Taxable
-- Income and TDS Amount, then combined into one verdict).
--
-- Root cause of the false mismatch this fixes: 24Q Office Data carries TWO
-- independent figures per employee (Taxable Income, TDS Amount), and some
-- clients keep them in TWO SEPARATE Tally ledgers (a "Staff Salary Expense"
-- ledger booking the gross/taxable figure, a "TDS 192B"-style liability
-- ledger booking the TDS itself) - never in one. The existing single-ledger
-- model (tally_party/tally_date/tally_credit/amount_basis, still used
-- UNCHANGED for 26Q/27EQ/any single-ledger 24Q client) tries ONE ledger
-- credit against EITHER office figure; fed a salary-ledger row, it correctly
-- refuses to call a taxable-income figure a TDS match and reports a
-- fabricated "Credit Amount Mismatch" instead of reconciling each ledger
-- against its own corresponding office figure.
--
-- These columns hold the SALARY-ledger side of a dual-ledger client's
-- verdict; the existing tally_* columns keep holding the TDS-ledger side
-- exactly as before (amount_basis = 'tds'). All nullable - a single-ledger
-- client (the vast majority) leaves every one of these null, unchanged.

ALTER TABLE public.tds_tally_results
  ADD COLUMN IF NOT EXISTS salary_tally_row_index integer,
  ADD COLUMN IF NOT EXISTS salary_tally_party     text,
  ADD COLUMN IF NOT EXISTS salary_tally_date      text,
  ADD COLUMN IF NOT EXISTS salary_tally_credit    numeric,
  -- Per-figure sub-verdicts so a checker sees exactly which side is wrong
  -- without parsing the reason sentence: 'Matched' | 'Missing from Ledger' |
  -- 'Missing from Office Data' | 'Amount Mismatch' | 'Date Mismatch' |
  -- 'Name Mismatch' | null (single-ledger client, not applicable).
  ADD COLUMN IF NOT EXISTS taxable_income_status  text,
  ADD COLUMN IF NOT EXISTS tds_status             text;

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
    salary_tally_row_index, salary_tally_party, salary_tally_date, salary_tally_credit,
    taxable_income_status, tds_status,
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
    (r->>'salary_tally_row_index')::integer,
    r->>'salary_tally_party',
    r->>'salary_tally_date',
    (r->>'salary_tally_credit')::numeric,
    r->>'taxable_income_status',
    r->>'tds_status',
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
