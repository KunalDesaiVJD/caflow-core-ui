SELECT e.id AS engagement_id, c.name AS client
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
LIMIT 1;
