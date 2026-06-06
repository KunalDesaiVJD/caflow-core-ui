-- Capture current other_expenses note total BEFORE correction
SELECT
  jsonb_array_length(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) AS custom_rows_before,
  (nfn.cy_data->'travel') AS travel_before,
  (nfn.cy_data->'custom_web_developing_fees_exp_90') AS webdev_before
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN nce_financial_notes nfn ON nfn.engagement_id = e.id AND nfn.financial_year = e.financial_year
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND nfn.note_type = 'other_expenses';
