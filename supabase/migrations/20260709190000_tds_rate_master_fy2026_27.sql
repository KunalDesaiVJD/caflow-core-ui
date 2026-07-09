-- Populate TDS Rate Master for Tax Year 2026-27 (financial_year = '2026-27'),
-- carrying forward Tax Year 2025-26 data with Finance Act 2025 corrections
-- applied (effective 1 Apr 2025, continuing unchanged into FY 2026-27).
-- Tax Year 2025-26 itself is left untouched, per explicit instruction.
--
-- Corrections applied (section_code -> what changed), sourced against the
-- enacted Finance Act 2025 gazette text and cross-checked secondary sources:
--   194                     Dividend threshold           5,000  -> 10,000
--   194A- Other than Bank   threshold                    5,000  -> 10,000
--   194G                    threshold / rate      15,000/5%  -> 20,000/2%
--   194H                    threshold                   15,000 -> 20,000  (rate unverified, left at 5%)
--   194J(a) / 194J(b)       threshold                   30,000 -> 50,000
--   194K                    threshold                    5,000 -> 10,000
--   194LA                   threshold                  250,000 -> 500,000
--   194DA                   rate                            5% -> 2%  (changed 1 Oct 2024, Finance (No.2) Act 2024 — predates this baseline)
--   194M                    rate                            5% -> 2%  (changed 1 Oct 2024, Finance (No.2) Act 2024 — predates this baseline)
--   194LD                   rate                            5% -> 20% (concessional rate lapsed 1-Jul-2023, never restored)
--   206C(1G)(a)             threshold                  700,000 -> 1,000,000
--
-- Already correct in production (Finance Act 2025 already reflected, no change):
--   194A, 194A-SC, 194-I(a), 194-I(b)
--
-- Excluded entirely (TCS provisions abolished by Finance Act 2025, eff. 1 Apr 2025):
--   206C(1G)(b) Education Loan Remittance, 206C(1H) Sale of Goods
--
-- Everything else is carried forward unchanged (no Finance Act 2025 impact found).

INSERT INTO tds_rate_master (
  firm_id, financial_year, assessment_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company,
  rate_no_pan, surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes
)
SELECT
  firm_id,
  '2026-27' AS financial_year,
  '2027-28' AS assessment_year,
  form_type,
  section_code,
  section_description,
  nature_of_payment,
  CASE section_code
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
  END AS threshold_individual,
  CASE section_code
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
  END AS threshold_company,
  CASE section_code
    WHEN '194G' THEN 2
    WHEN '194DA' THEN 2
    WHEN '194M' THEN 2
    WHEN '194LD' THEN 20
    ELSE rate_individual
  END AS rate_individual,
  CASE section_code
    WHEN '194G' THEN 2
    WHEN '194DA' THEN 2
    WHEN '194LD' THEN 20
    ELSE rate_company
  END AS rate_company,
  rate_no_pan,
  surcharge_applicable,
  cess_applicable,
  is_active,
  effective_from,
  effective_to,
  CASE section_code
    WHEN '194LC' THEN trim(both ' ' from coalesce(notes, '') || ' Concessional rate (5%) applies only to loans/bonds executed before 1 Jul 2023 (grandfathered through tenure); new arrangements do not qualify — 9% for IFSC-listed bonds issued on/after that date, else standard non-resident rate applies. Verify per transaction.')
    WHEN '194Q' THEN trim(both ' ' from coalesce(notes, '') || ' Finance Act 2025 includes an amendment clause referencing this section; specific effect not independently confirmed as of this update — verify with a tax advisor.')
    WHEN '194S' THEN trim(both ' ' from coalesce(notes, '') || ' Finance Act 2025 includes an amendment clause referencing this section; specific effect not independently confirmed as of this update — verify with a tax advisor.')
    WHEN '194H' THEN trim(both ' ' from coalesce(notes, '') || ' Threshold raised per Finance Act 2025. One source suggested a possible rate reduction to 2%; not independently confirmed, rate left unchanged at 5% pending verification.')
    WHEN '194LD' THEN 'Concessional 5% rate lapsed for interest payable on/after 1 Jul 2023 and was never restored (verified against Finance Act 2020/2023/2025 gazette text); standard 20% now applies, subject to any applicable DTAA rate.'
    ELSE notes
  END AS notes
FROM tds_rate_master
WHERE financial_year = '2025-26'
  AND section_code NOT IN ('206C(1G)(b)', '206C(1H)')
ON CONFLICT (assessment_year, form_type, section_code, firm_id) DO NOTHING;
