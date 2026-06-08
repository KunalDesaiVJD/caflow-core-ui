-- Check current state of Note 19 for SHRI RAM PRODUCTS:
-- 1. When was it last updated?
-- 2. Does it contain Web Developing Fees Exp?
-- 3. What's the total?
SELECT
  nfn.updated_at,
  nfn.cy_data ? 'custom_web_developing_fees_exp' AS has_webdev_key,
  (SELECT count(*) FROM jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr
   WHERE cr->>'label' ILIKE '%web develop%') AS webdev_row_count,
  jsonb_array_length(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) AS total_custom_rows,
  (SELECT string_agg(cr->>'label', ', ' ORDER BY cr->>'label')
   FROM jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr) AS all_row_labels
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN nce_financial_notes nfn ON nfn.engagement_id = e.id AND nfn.financial_year = e.financial_year
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND nfn.note_type = 'other_expenses';
