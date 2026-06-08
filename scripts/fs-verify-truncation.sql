-- Verify: how many TB rows does SHRI RAM have, and is Web Developing
-- beyond position 1000 alphabetically?
SELECT
  COUNT(*) AS total_tb_rows,
  (SELECT COUNT(*) FROM tally_trial_balance tb2
   WHERE tb2.engagement_id = e.id
   AND tb2.ledger_name <= 'Web Developing Fees Exp'
   ORDER BY tb2.ledger_name) AS position_of_webdev
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN tally_trial_balance tb ON tb.engagement_id = e.id
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
GROUP BY e.id;
