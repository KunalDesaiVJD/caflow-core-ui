-- Prevent tds_filings duplicates going forward. A concurrent call to the
-- auto-creation logic (syncMissingFilings / TdsDataEntry's loadFiling) could
-- race a check-then-insert and create two rows for the same
-- (client_id, financial_year, quarter, tds_forms) — this is what produced
-- the duplicates cleaned up in 20260710160000/20260710160500.
--
-- One group is deliberately excluded: client eda02018-ba5f-45d5-b0fc-993da42185cb,
-- FY 2025-26 Q4, 26Q — it has two rows with real, differing challan/deductee
-- data that needs manual review/merge in the app before it can satisfy this
-- constraint. Drop and recreate as a plain (non-partial) unique index once
-- that pair is resolved.
CREATE UNIQUE INDEX IF NOT EXISTS tds_filings_unique_period_form
  ON public.tds_filings (client_id, financial_year, quarter, tds_forms)
  WHERE NOT (
    client_id = 'eda02018-ba5f-45d5-b0fc-993da42185cb'
    AND financial_year = '2025-26'
    AND quarter = 'Q4'
    AND tds_forms = ARRAY['26Q']
  );
