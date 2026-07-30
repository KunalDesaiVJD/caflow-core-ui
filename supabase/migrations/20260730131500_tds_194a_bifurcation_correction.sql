-- Corrects a mistake in migration 20260730130000: that migration assumed
-- "194A" was a single flat section needing a NEW 3-way split (194A(a)/(b)/(c))
-- to match the Section 393 PDF's Senior-Citizen/Other-Individual/Others
-- breakdown. In fact this codebase ALREADY had that exact 3-way split under
-- different pre-existing names — "194A" (₹50,000 threshold = Other
-- Individuals), "194A-SC" (₹1,00,000 = Senior Citizens), and
-- "194A- Other than Bank" (₹10,000 = Others) — created back in Mar/Apr 2026,
-- well before this session. The new 194A(a)/(b)/(c) rows duplicated these.
--
-- This migration: removes the duplicate 194A(a)/(b)/(c) rows, restores
-- "194A" FY2026-27 to is_active=true (it was wrongly deactivated), and
-- attaches the Section 393 label metadata to the three PRE-EXISTING rows
-- instead.

DELETE FROM tds_rate_master WHERE section_code IN ('194A(a)', '194A(b)', '194A(c)')
  AND financial_year='2026-27';

UPDATE tds_rate_master SET is_active=true,
  notes=regexp_replace(notes, ' \| Superseded for FY2026-27 by Section 393 payment-code bifurcation \(194A\(a\)/\(b\)/\(c\)\) — see migration 20260730130000\.$', '')
  WHERE section_code='194A' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1021', new_section_code='393(1) [Table: S.N. 5(ii).D(b)]',
  new_section_description='Interest other than securities - Other Individuals'
  WHERE section_code='194A' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1020', new_section_code='393(1) [Table: S.N. 5(ii).D(a)]',
  new_section_description='Interest other than securities - Senior Citizens'
  WHERE section_code='194A-SC' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1022', new_section_code='393(1) [Table: S.N. 5(iii)]',
  new_section_description='Interest other than securities - Others'
  WHERE section_code='194A- Other than Bank' AND financial_year='2026-27';
