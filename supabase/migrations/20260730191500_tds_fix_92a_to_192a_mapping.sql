-- User-confirmed: "92A" and "192A" refer to the same section (a Genius-
-- import file used its own "92A" notation for Section 192A - premature EPF
-- withdrawal - which CAFlow's import seed table didn't recognise, so
-- ensureRateMasterSections() in genius-import.ts correctly created a 0%
-- placeholder row per its own designed safety-net behaviour, rather than
-- silently guessing a rate).
--
-- Relabels the 667 tds_deductees rows and 15 tds_challans rows from "92A"
-- to "192A" (the real, already-active, correctly-rated section) — a pure
-- section_code correction. Does NOT touch tds_amount, rate_of_tds, or any
-- other financial figure on these rows: those were already computed by
-- whatever process created them, and are left exactly as they are.
--
-- The two now-orphaned "92A" rate_master placeholder rows (24Q + 26Q,
-- FY2026-27) are deactivated afterward, once nothing references them.

UPDATE tds_deductees SET section_code='192A' WHERE section_code='92A';
UPDATE tds_challans SET section_code='192A' WHERE section_code='92A';

UPDATE tds_rate_master SET is_active=false,
  notes=coalesce(notes || ' | ', '') || 'Deactivated: user confirmed 92A and 192A are the same section; all referencing tds_deductees/tds_challans rows relabelled to 192A, migration 20260730191500.'
  WHERE section_code='92A';
