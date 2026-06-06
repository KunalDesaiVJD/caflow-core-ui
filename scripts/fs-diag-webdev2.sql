-- Check the other_expenses note for SHRI RAM PRODUCTS
-- Look for: ejected ledgers, custom rows, and whether Web Developing appears
SELECT
  nfn.note_type,
  -- Check if Web Developing is in ejected list
  nfn.cy_data->'_ejected_ledgers' AS ejected_ledgers,
  -- Check custom rows for any that might claim the name
  jsonb_array_length(COALESCE(nfn.cy_data->'_custom_rows', '[]'::jsonb)) AS custom_row_count,
  -- Check if the ledger amount exists in cy_data
  nfn.cy_data->'Web Developing Fees Exp' AS cy_value_direct,
  -- Check total keys in cy_data (to see what's there)
  (SELECT count(*) FROM jsonb_each(nfn.cy_data) WHERE key NOT LIKE '\_%') AS numeric_key_count
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN nce_financial_notes nfn
  ON nfn.engagement_id = e.id
  AND nfn.financial_year = e.financial_year
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND nfn.note_type = 'other_expenses';
