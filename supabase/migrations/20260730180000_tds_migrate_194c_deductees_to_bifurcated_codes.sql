-- Per explicit user request: existing tds_deductees rows still tagged with
-- the generic "194C" should be updated to the correct bifurcated option
-- (194C(a) Individual/HUF 1% = Payment Code 1023, or 194C(b) Others 2% =
-- Payment Code 1024) rather than staying on the pre-reform generic code —
-- WITHOUT deleting or recreating any row.
--
-- Scoped to financial_year='2026-27' only (the Section 393 reform is
-- prospective from 1-Apr-2026; FY2025-26 rows correctly keep the old plain
-- "194C" code, since that's what applied when those transactions occurred).
--
-- The stored deductee_type column is NOT a reliable signal here: a data
-- audit found "Non-Company" deductees split across BOTH rate_of_tds=1 (466
-- rows) and rate_of_tds=2 (94 rows) for this same section/year — i.e. that
-- label alone cannot distinguish which bracket a row actually belongs to.
-- The actual rate charged at deduction time (rate_of_tds) is the reliable
-- fact: 1% is uniquely the Individual/HUF bracket, 2% is uniquely the
-- Others bracket, for 194C specifically (no other rate value existed in
-- this section+year: verified 547 rows at exactly 1%, 207 at exactly 2%,
-- pan_not_available=false throughout, before running this).

UPDATE tds_deductees SET section_code='194C(a)'
  WHERE section_code='194C' AND financial_year='2026-27'
  AND pan_not_available=false AND rate_of_tds=1;

UPDATE tds_deductees SET section_code='194C(b)'
  WHERE section_code='194C' AND financial_year='2026-27'
  AND pan_not_available=false AND rate_of_tds=2;

-- tds_correction_deductees checked separately: all 177 of its "194C" rows
-- are financial_year='2025-26' (none in FY2026-27), so nothing there needs
-- migrating — left untouched.
