-- Found during the same audit that caught 92A: two more data-consistency
-- gaps in tds_deductees/tds_challans, same root cause as 92A (an import
-- source's own code spelling never got relabelled to CAflow's canonical
-- form after the reference row was fixed).
--
-- 1. "92B" (348 deductees + 14 challans): the malformed-92B rate_master row
--    was ALREADY deactivated by an earlier round's rate-law-correction
--    migration (192B/"Salary" is the real, active, already-correct
--    section) — but the underlying tds_deductees/tds_challans rows that
--    referenced "92B" were never relabelled at the time, leaving 362 real
--    rows pointing at a dead code (same blank-dropdown risk as 92A/194C
--    earlier this session).
--
-- 2. "194J(B)" (21 deductees, capital B): a casing variant of "194J(b)"
--    (378 deductees use the correct lowercase form already). Both mean the
--    same thing; relabelled to the established casing for consistency.

UPDATE tds_deductees SET section_code='192B' WHERE section_code='92B';
UPDATE tds_challans SET section_code='192B' WHERE section_code='92B';

UPDATE tds_deductees SET section_code='194J(b)' WHERE section_code='194J(B)';
