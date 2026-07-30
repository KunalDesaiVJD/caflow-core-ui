-- Income Tax Act 2025 / Section 393 TDS reorganisation (effective 1-Apr-2026,
-- FY2026-27 onward). Adds new-format section labels used to build the
-- "Payment Code : [Old Section] : New Section Code – Description" dropdown
-- text. FY2025-26 rows are completely untouched: the reform is prospective
-- only, and pre-1-Apr-2026 transactions still use the old section codes.
--
-- Source: user-supplied CBDT-derived mapping table (K:\TDS.pdf), the ONLY
-- source treated as authoritative here. Two independent secondary web
-- sources checked for sections outside that table (Terra Insight,
-- taxgarden.in) actively disagreed with each other AND with the user's own
-- document on at least one figure (194C's payment code — taxgarden.in said
-- 1005/1006, the user's own PDF says 1023/1024) — so codes are populated
-- ONLY for the ~15 sections the PDF actually covers. Every other section
-- keeps its plain old-section label until a verified source is available.

ALTER TABLE tds_rate_master
  ADD COLUMN IF NOT EXISTS payment_code text,
  ADD COLUMN IF NOT EXISTS new_section_code text,
  ADD COLUMN IF NOT EXISTS new_section_description text;

-- ── Single-code sections: label metadata only, no bifurcation ──
UPDATE tds_rate_master SET payment_code='1004', new_section_code='393(7)',
  new_section_description='Premature withdrawal from Employees'' Provident Fund'
  WHERE section_code='192A' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1019', new_section_code='393(1) [Table: S.N. 5(i)]',
  new_section_description='Interest on securities'
  WHERE section_code='193' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1029', new_section_code='393(1) [Table: S.N. 7]',
  new_section_description='Dividend'
  WHERE section_code='194' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1006', new_section_code='393(1) [Table: S.N. 1(ii)]',
  new_section_description='Commission or brokerage'
  WHERE section_code='194H' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1008', new_section_code='393(1) [Table: S.N. 2(ii).D(a)]',
  new_section_description='Rent - Plant & Machinery'
  WHERE section_code='194I(a)' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1009', new_section_code='393(1) [Table: S.N. 2(ii).D(b)]',
  new_section_description='Rent - Land/Building/Furniture'
  WHERE section_code='194I(b)' AND financial_year='2026-27';

-- 194J(a) in this codebase's convention = Professional Services (10%);
-- 194J(b) = Technical Services (2%) — confirmed against live nature_of_payment
-- values before assigning, since the PDF's own A/B lettering is the reverse.
UPDATE tds_rate_master SET payment_code='1027', new_section_code='393(1) [Table: S.N. 6(iii).D(b)]',
  new_section_description='Professional services / director remuneration'
  WHERE section_code='194J(a)' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1026', new_section_code='393(1) [Table: S.N. 6(iii).D(a)]',
  new_section_description='Fees for technical services'
  WHERE section_code='194J(b)' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1031', new_section_code='393(1) [Table: S.N. 8(ii)]',
  new_section_description='Purchase of goods (buyer TDS)'
  WHERE section_code='194Q' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1067', new_section_code='393(3) [Table: S.N. 7]',
  new_section_description='Payment to partners of a firm (salary/remuneration/interest)'
  WHERE section_code='194T' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1073', new_section_code='394(1) [Table: S.N. 4]',
  new_section_description='Sale of scrap (TCS)'
  WHERE section_code='206C(1)' AND financial_year='2026-27';

-- ── Bifurcated sections ──
-- Each existing plain section_code is deactivated for FY2026-27 ONLY
-- (is_active=false, never deleted — same audit-trail pattern as the earlier
-- 194F/malformed-92B/mis-filed-194C corrections) and replaced by per-variant
-- rows carrying their own payment code, since the new Act's code choice IS
-- the rate determinant rather than a deductee-type branch within one row.
-- FY2025-26 rows for these same section_codes are untouched.

UPDATE tds_rate_master SET is_active=false,
  notes=coalesce(notes || ' | ', '') || 'Superseded for FY2026-27 by Section 393 payment-code bifurcation (194A(a)/(b)/(c)) — see migration 20260730130000.'
  WHERE section_code='194A' AND financial_year='2026-27';

INSERT INTO tds_rate_master (assessment_year, financial_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes, firm_id,
  payment_code, new_section_code, new_section_description)
SELECT assessment_year, financial_year, form_type, '194A(a)', section_description,
  'Interest other than securities - Senior Citizens', 100000, 100000, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, true, '2026-04-01'::date, effective_to,
  'Added by Section 393 payment-code bifurcation, migration 20260730130000.', firm_id,
  '1020', '393(1) [Table: S.N. 5(ii).D(a)]', 'Interest other than securities - Senior Citizens'
FROM tds_rate_master WHERE section_code='194A' AND financial_year='2026-27'
ON CONFLICT DO NOTHING;

INSERT INTO tds_rate_master (assessment_year, financial_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes, firm_id,
  payment_code, new_section_code, new_section_description)
SELECT assessment_year, financial_year, form_type, '194A(b)', section_description,
  'Interest other than securities - Other Individuals', 50000, 50000, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, true, '2026-04-01'::date, effective_to,
  'Added by Section 393 payment-code bifurcation, migration 20260730130000.', firm_id,
  '1021', '393(1) [Table: S.N. 5(ii).D(b)]', 'Interest other than securities - Other Individuals'
FROM tds_rate_master WHERE section_code='194A' AND financial_year='2026-27'
ON CONFLICT DO NOTHING;

INSERT INTO tds_rate_master (assessment_year, financial_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes, firm_id,
  payment_code, new_section_code, new_section_description)
SELECT assessment_year, financial_year, form_type, '194A(c)', section_description,
  'Interest other than securities - Others', 10000, 10000, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, true, '2026-04-01'::date, effective_to,
  'Added by Section 393 payment-code bifurcation, migration 20260730130000.', firm_id,
  '1022', '393(1) [Table: S.N. 5(iii)]', 'Interest other than securities - Others'
FROM tds_rate_master WHERE section_code='194A' AND financial_year='2026-27'
ON CONFLICT DO NOTHING;

UPDATE tds_rate_master SET is_active=false,
  notes=coalesce(notes || ' | ', '') || 'Superseded for FY2026-27 by Section 393 payment-code bifurcation (194C(a)/(b)) — see migration 20260730130000.'
  WHERE section_code='194C' AND financial_year='2026-27';

INSERT INTO tds_rate_master (assessment_year, financial_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes, firm_id,
  payment_code, new_section_code, new_section_description)
SELECT assessment_year, financial_year, form_type, '194C(a)', section_description,
  'Contractor / Sub-contractor - Individual/HUF', threshold_individual, threshold_individual, rate_individual, rate_individual, rate_no_pan,
  surcharge_applicable, cess_applicable, true, '2026-04-01'::date, effective_to,
  'Added by Section 393 payment-code bifurcation, migration 20260730130000.', firm_id,
  '1023', '393(1) [Table: S.N. 6(i).D(a)]', 'Payments to contractors and sub-contractors (Individual/HUF)'
FROM tds_rate_master WHERE section_code='194C' AND financial_year='2026-27'
ON CONFLICT DO NOTHING;

INSERT INTO tds_rate_master (assessment_year, financial_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes, firm_id,
  payment_code, new_section_code, new_section_description)
SELECT assessment_year, financial_year, form_type, '194C(b)', section_description,
  'Contractor / Sub-contractor - Others', threshold_company, threshold_company, rate_company, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, true, '2026-04-01'::date, effective_to,
  'Added by Section 393 payment-code bifurcation, migration 20260730130000.', firm_id,
  '1024', '393(1) [Table: S.N. 6(i).D(b)]', 'Payments to contractors and sub-contractors (Others)'
FROM tds_rate_master WHERE section_code='194C' AND financial_year='2026-27'
ON CONFLICT DO NOTHING;

UPDATE tds_rate_master SET is_active=false,
  notes=coalesce(notes || ' | ', '') || 'Superseded for FY2026-27 by Section 393 payment-code bifurcation (194R(a)/(b)) — see migration 20260730130000.'
  WHERE section_code='194R' AND financial_year='2026-27';

INSERT INTO tds_rate_master (assessment_year, financial_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes, firm_id,
  payment_code, new_section_code, new_section_description)
SELECT assessment_year, financial_year, form_type, '194R(a)', section_description,
  'Perquisite/benefit in business or profession - Cash', threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, true, '2026-04-01'::date, effective_to,
  'Added by Section 393 payment-code bifurcation, migration 20260730130000.', firm_id,
  '1034', '393(1) [Table: S.N. 8(iv)]', 'Perquisite/benefit in business or profession (Cash)'
FROM tds_rate_master WHERE section_code='194R' AND financial_year='2026-27'
ON CONFLICT DO NOTHING;

INSERT INTO tds_rate_master (assessment_year, financial_year, form_type, section_code, section_description,
  nature_of_payment, threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, is_active, effective_from, effective_to, notes, firm_id,
  payment_code, new_section_code, new_section_description)
SELECT assessment_year, financial_year, form_type, '194R(b)', section_description,
  'Perquisite/benefit in business or profession - In Kind/Mixed', threshold_individual, threshold_company, rate_individual, rate_company, rate_no_pan,
  surcharge_applicable, cess_applicable, true, '2026-04-01'::date, effective_to,
  'Added by Section 393 payment-code bifurcation, migration 20260730130000.', firm_id,
  '1035', '393(1) [Table: S.N. 8(iv) Note 6]', 'Perquisite/benefit in business or profession (In Kind/Mixed)'
FROM tds_rate_master WHERE section_code='194R' AND financial_year='2026-27'
ON CONFLICT DO NOTHING;
