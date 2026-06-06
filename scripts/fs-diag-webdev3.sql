-- Dump all custom rows in other_expenses note to check if any claims "Web Developing"
-- Also check: when was this note last updated vs when was auto-sync last run
SELECT
  cr->>'id' AS row_id,
  cr->>'label' AS label,
  cr->>'source' AS source,
  cr->>'tbDerived' AS tb_derived,
  cr->>'attachedTo' AS attached_to,
  nfn.cy_data->>(cr->>'id') AS cy_amount,
  nfn.updated_at
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN nce_financial_notes nfn
  ON nfn.engagement_id = e.id
  AND nfn.financial_year = e.financial_year,
LATERAL jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows', '[]'::jsonb)) AS cr
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND nfn.note_type = 'other_expenses'
ORDER BY cr->>'label';
