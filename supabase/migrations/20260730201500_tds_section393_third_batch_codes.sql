-- Third batch: 3 of the 11 newly-discovered sections get a verified,
-- unambiguous Payment Code. The other 8 are DELIBERATELY skipped, each for
-- a specific, checked reason (not laziness — every one was investigated):
--
-- - 194LC, 196C, 206C(1C), 206C(1G)(a): each splits into 2-4 DIFFERENT
--   payment codes depending on a sub-type this app's single section_code
--   doesn't capture (bond-type for 194LC; interest-vs-LTCG for 196C;
--   parking/toll/mining for 206C(1C); education-medical-vs-other purpose
--   for 206C(1G)(a)). Picking one would misrepresent the others — same
--   principle as the earlier 194O exclusion, just for a different reason
--   (multiple valid codes instead of zero).
-- - 194LD: the research adjudicator specifically traced the code some
--   sources attribute to 194LD and found it actually belongs to 194LC
--   (near-identical bond-interest phrasing, confirmed via bare Act text
--   comparison) — genuinely no code found, not just low confidence.
-- - 194N-F / 194N-NF: research found the real Act structure splits this
--   provision by DEDUCTEE TYPE (co-operative society vs other), not by
--   filer status the way this app's section_code names suggest. There is
--   no filer-specific code to attach without misrepresenting the actual
--   distinction the new Act draws.
--
-- 194LB-NR gets the SAME code as 194LB (already applied in migration
-- 20260730130000): both resolve to identical rate (5%/5%), citation
-- (393(2) Table S.No. 5) and code (1044) across two independent research
-- passes — confirmed to be the same provision recorded under two form
-- types (26Q vs 27Q), not a genuine collision.

UPDATE tds_rate_master SET payment_code='1039', new_section_code='393(2) [Table: S.No. 1]',
  new_section_description='Payment to non-resident sportsmen/sports associations or entertainers'
  WHERE section_code='194E' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1044', new_section_code='393(2) [Table: S.No. 5]',
  new_section_description='Interest from an infrastructure debt fund, paid to a non-resident'
  WHERE section_code='194LB-NR' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1018', new_section_code='393(1) [Table: Sl. No. 4(iv)]',
  new_section_description='Income from investment in a securitisation trust, paid to a resident'
  WHERE section_code='194LBC' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1051', new_section_code='393(2) [Table: Sl. No. 11]',
  new_section_description='Income from units of an offshore fund'
  WHERE section_code='196B' AND financial_year='2026-27';
