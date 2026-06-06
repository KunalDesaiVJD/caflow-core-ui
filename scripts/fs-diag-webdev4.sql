-- Check ALL numeric keys in other_expenses cy_data
-- to see if "Web Developing" was merged into a static row
SELECT
  key,
  value::text AS cy_value
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN nce_financial_notes nfn
  ON nfn.engagement_id = e.id
  AND nfn.financial_year = e.financial_year,
LATERAL jsonb_each(nfn.cy_data) AS kv(key, value)
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND nfn.note_type = 'other_expenses'
  AND key NOT LIKE '\_%'
ORDER BY key;
