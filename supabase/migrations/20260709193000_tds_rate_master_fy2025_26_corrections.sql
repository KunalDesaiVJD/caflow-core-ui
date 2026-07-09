-- Correct the Tax Year 2025-26 (financial_year = '2025-26') TDS Rate Master
-- baseline itself, applying the same Finance Act 2025 corrections (effective
-- 1 Apr 2025, i.e. from the start of FY 2025-26) already applied when
-- populating Tax Year 2026-27 in migration 20260709190000. Mirrors that
-- migration's correction list exactly — see it for full sourcing notes.
--
-- Deletes the two TCS provisions abolished by Finance Act 2025 (effective
-- 1 Apr 2025 — i.e. inapplicable for the entire FY 2025-26 period):
--   206C(1G)(b) Education Loan Remittance, 206C(1H) Sale of Goods

UPDATE tds_rate_master
SET
  threshold_individual = CASE section_code
    WHEN '194' THEN 10000
    WHEN '194A- Other than Bank' THEN 10000
    WHEN '194G' THEN 20000
    WHEN '194H' THEN 20000
    WHEN '194J(a)' THEN 50000
    WHEN '194J(b)' THEN 50000
    WHEN '194K' THEN 10000
    WHEN '194LA' THEN 500000
    WHEN '206C(1G)(a)' THEN 1000000
    ELSE threshold_individual
  END,
  threshold_company = CASE section_code
    WHEN '194' THEN 10000
    WHEN '194A- Other than Bank' THEN 10000
    WHEN '194G' THEN 20000
    WHEN '194H' THEN 20000
    WHEN '194J(a)' THEN 50000
    WHEN '194J(b)' THEN 50000
    WHEN '194K' THEN 10000
    WHEN '194LA' THEN 500000
    WHEN '206C(1G)(a)' THEN 1000000
    ELSE threshold_company
  END,
  rate_individual = CASE section_code
    WHEN '194G' THEN 2
    WHEN '194DA' THEN 2
    WHEN '194M' THEN 2
    WHEN '194LD' THEN 20
    ELSE rate_individual
  END,
  rate_company = CASE section_code
    WHEN '194G' THEN 2
    WHEN '194DA' THEN 2
    WHEN '194LD' THEN 20
    ELSE rate_company
  END,
  notes = CASE section_code
    WHEN '194LC' THEN trim(both ' ' from coalesce(notes, '') || ' Concessional rate (5%) applies only to loans/bonds executed before 1 Jul 2023 (grandfathered through tenure); new arrangements do not qualify — 9% for IFSC-listed bonds issued on/after that date, else standard non-resident rate applies. Verify per transaction.')
    WHEN '194Q' THEN trim(both ' ' from coalesce(notes, '') || ' Finance Act 2025 includes an amendment clause referencing this section; specific effect not independently confirmed as of this update — verify with a tax advisor.')
    WHEN '194S' THEN trim(both ' ' from coalesce(notes, '') || ' Finance Act 2025 includes an amendment clause referencing this section; specific effect not independently confirmed as of this update — verify with a tax advisor.')
    WHEN '194H' THEN trim(both ' ' from coalesce(notes, '') || ' Threshold raised per Finance Act 2025. One source suggested a possible rate reduction to 2%; not independently confirmed, rate left unchanged at 5% pending verification.')
    WHEN '194LD' THEN 'Concessional 5% rate lapsed for interest payable on/after 1 Jul 2023 and was never restored (verified against Finance Act 2020/2023/2025 gazette text); standard 20% now applies, subject to any applicable DTAA rate.'
    ELSE notes
  END
WHERE financial_year = '2025-26'
  AND section_code IN ('194','194A- Other than Bank','194G','194H','194J(a)','194J(b)','194K','194LA','194DA','194M','194LD','206C(1G)(a)','194LC','194Q','194S');

DELETE FROM tds_rate_master
WHERE financial_year = '2025-26'
  AND section_code IN ('206C(1G)(b)', '206C(1H)');
