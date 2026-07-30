-- The blanket "WHERE section_code='194C' AND financial_year='2026-27'"
-- reactivation in migration 20260730170000 (fixing the blank-Section-
-- dropdown regression) had no form_type filter, so it also reactivated the
-- FY2026-27 copy of a row an EARLIER, unrelated round had correctly
-- deactivated: 194C mis-filed under form_type='24Q' (194C is a contractor-
-- payment section; it has no place on a 24Q salary-only return — a
-- data-hygiene fix, values were a copy/paste of the correct 26Q row).
--
-- Re-deactivates that one row (by id, not a blanket WHERE, to avoid
-- repeating the same mistake). The 26Q "194C" FY2026-27 row stays active,
-- which is what actually fixes the blank-dropdown regression.

UPDATE tds_rate_master SET is_active=false
  WHERE id='d45f887e-38f3-4b3d-9af2-97126b9768c8'
  AND section_code='194C' AND form_type='24Q' AND financial_year='2026-27';
