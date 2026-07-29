-- Corrects TDS rates in tds_rate_master that were verified stale against
-- current Income Tax law, and cleans up two malformed data rows found during
-- the same audit. Every correction below was independently confirmed against
-- 2+ reputable sources (ClearTax, TaxGuru, IndiaFilings, CAclubindia,
-- incometaxindia.gov.in for 194F) before being applied here — see the
-- conversation this migration shipped from for full citations.
--
-- All of these changes predate BOTH financial_year rows currently in the
-- table (2025-26 starts 1-Apr-2025, 2026-27 starts 1-Apr-2026), so a flat
-- correction to both years is correct — no mid-year historical split is
-- needed for THIS table's existing data (a transaction dated in FY2024-25,
-- before any of these rows, isn't representable here regardless).
--
-- 1. Section 194H (Commission or Brokerage): rate cut 5% -> 2%, effective
--    1-Oct-2024 (Finance (No.2) Act 2024). The DB still had 5%/5%; only the
--    ₹20,000 threshold (a separate, later Finance Act 2025 change) had been
--    applied. Confirmed already once directly from the live DB this session
--    (see the "Section 194H is confirmed wrong" report) — this migration is
--    that promised fix.
UPDATE tds_rate_master
SET rate_individual = 2, rate_company = 2
WHERE section_code = '194H' AND form_type = '26Q'
  AND financial_year IN ('2025-26', '2026-27');

-- 2. Section 194D (Insurance Commission): individual/HUF rate cut 5% -> 2%,
--    effective 1-Apr-2025 (Finance Act 2025). Company rate (10%) unaffected.
UPDATE tds_rate_master
SET rate_individual = 2
WHERE section_code = '194D' AND form_type = '26Q'
  AND financial_year IN ('2025-26', '2026-27');

-- 3. Section 194-IB (Rent by Individual/HUF not subject to tax audit): rate
--    cut 5% -> 2%, effective 1-Oct-2024 (Finance (No.2) Act 2024).
UPDATE tds_rate_master
SET rate_individual = 2
WHERE section_code = '194IB' AND form_type = '26Q'
  AND financial_year IN ('2025-26', '2026-27');

-- 3b. Section 194DA (Life Insurance Policy maturity payout, non-exempt under
--    Sec 10(10D)): rate cut 5% -> 2%, effective 1-Oct-2024 (Finance (No.2)
--    Act 2024). Applies to both individual and company rates identically.
UPDATE tds_rate_master
SET rate_individual = 2, rate_company = 2
WHERE section_code = '194DA' AND form_type = '26Q'
  AND financial_year IN ('2025-26', '2026-27');

-- 3c. Section 194G (Commission on sale of lottery tickets): rate cut 5% -> 2%,
--    effective 1-Oct-2024 (Finance (No.2) Act 2024). Threshold raised
--    ₹15,000 -> ₹20,000, effective 1-Apr-2025 (Finance Act 2025) — the DB
--    already had ₹20,000; only the rate itself was stale.
UPDATE tds_rate_master
SET rate_individual = 2, rate_company = 2
WHERE section_code = '194G' AND form_type = '26Q'
  AND financial_year IN ('2025-26', '2026-27');

-- 4. Section 194F (Repurchase of units by Mutual Fund/UTI) was OMITTED from
--    the Income-tax Act entirely by Finance (No.2) Act 2024, effective
--    1-Oct-2024 — confirmed directly against incometaxindia.gov.in's own
--    section listing ("Omitted w.e.f. 01.10.2024"). No TDS applies under it
--    at all any more. Deactivated rather than deleted, so the historical
--    rate remains visible for audit/reference.
UPDATE tds_rate_master
SET is_active = false,
    notes = trim(both ' ' from coalesce(notes, '') ||
      ' Section 194F was OMITTED by Finance (No.2) Act 2024, effective 1-Oct-2024 — no TDS applies under this section any more. Deactivated, not deleted, for audit history.')
WHERE section_code = '194F' AND form_type = '26Q'
  AND financial_year IN ('2025-26', '2026-27');

-- 5. Section 194LBC (Income from Securitisation Trusts, resident payees):
--    missing from the rate master entirely. Uniform 10% rate for all
--    resident payees, effective 1-Apr-2025 (Finance Act 2025) — replacing
--    the earlier 25% (individual/HUF) / 30% (others) split. The
--    non-resident case (40%, Sec 194LBC read with 195/DTAA) is NOT
--    representable in this individual/company/no-PAN shape and is
--    deliberately not seeded here.
INSERT INTO tds_rate_master (
  firm_id, financial_year, assessment_year, form_type, section_code,
  section_description, nature_of_payment, threshold_individual, threshold_company,
  rate_individual, rate_company, rate_no_pan, surcharge_applicable, cess_applicable,
  is_active, effective_from, notes
)
SELECT DISTINCT firm_id, '2025-26', '2026-27', '26Q', '194LBC',
  'Income from Securitisation Trust', 'Securitisation Trust income (resident payee)',
  0, 0, 10, 10, 20, false, false, true, '2025-04-01'::date,
  'Rate rationalised to a uniform 10% for all resident payees by Finance Act 2025, effective 1-Apr-2025 (was 25% individual/HUF, 30% others). Non-resident case (40%) not representable here — handle via Section 195/DTAA instead.'
FROM tds_rate_master
WHERE form_type = '26Q'
ON CONFLICT (assessment_year, form_type, section_code, firm_id) DO NOTHING;

INSERT INTO tds_rate_master (
  firm_id, financial_year, assessment_year, form_type, section_code,
  section_description, nature_of_payment, threshold_individual, threshold_company,
  rate_individual, rate_company, rate_no_pan, surcharge_applicable, cess_applicable,
  is_active, effective_from, notes
)
SELECT DISTINCT firm_id, '2026-27', '2027-28', '26Q', '194LBC',
  'Income from Securitisation Trust', 'Securitisation Trust income (resident payee)',
  0, 0, 10, 10, 20, false, false, true, '2025-04-01'::date,
  'Rate rationalised to a uniform 10% for all resident payees by Finance Act 2025, effective 1-Apr-2025 (was 25% individual/HUF, 30% others). Non-resident case (40%) not representable here — handle via Section 195/DTAA instead.'
FROM tds_rate_master
WHERE form_type = '26Q'
ON CONFLICT (assessment_year, form_type, section_code, firm_id) DO NOTHING;

-- 6. Data hygiene: a malformed section_code of literal '92B' (missing the
--    leading '1') was found in one firm's live data for form_type=24Q,
--    FY2026-27, with rate_individual=0 and rate_company=0 — a leftover
--    artifact of the "92B vs 192B" FVU-format confusion the app's own
--    reconciliation code already guards against (commit 2225edf1). Any
--    transaction tagged with this malformed code would silently compute 0%
--    TDS. Deactivated rather than deleted, for audit history.
UPDATE tds_rate_master
SET is_active = false,
    notes = trim(both ' ' from coalesce(notes, '') ||
      ' Malformed section_code (missing leading "1" — should be 192B). Deactivated as a data-hygiene fix; see commit 2225edf1 for the FVU "92B vs 192B" issue this row is a leftover artifact of.')
WHERE section_code = '92B' AND form_type = '24Q';

-- 7. Data hygiene: a '194C' (Contractor/Sub-contractor) row was found filed
--    under form_type=24Q, which is exclusively for salary TDS (Sections
--    192/192A) — 194C has no place on a 24Q return. Values were
--    byte-identical to the correct 26Q '194C' row, consistent with a
--    copy/paste mistake rather than a deliberate entry. Deactivated rather
--    than deleted, for audit history.
UPDATE tds_rate_master
SET is_active = false,
    notes = trim(both ' ' from coalesce(notes, '') ||
      ' Section 194C has no place on a 24Q (salary-only) return — deactivated as a data-hygiene fix. Values matched the correct 26Q row exactly, consistent with a copy/paste mistake.')
WHERE section_code = '194C' AND form_type = '24Q';
