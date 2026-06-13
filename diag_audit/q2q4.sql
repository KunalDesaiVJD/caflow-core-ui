-- Q2: notes that show a "N manual" badge but whose entire note total is ~0
SELECT c.name, n.note_type,
  jsonb_array_length(coalesce(n.cy_data->'_custom_rows','[]'::jsonb)) AS custom_rows,
  (SELECT count(*) FROM jsonb_array_elements(coalesce(n.cy_data->'_custom_rows','[]'::jsonb)) e WHERE e->>'source'='manual') AS manual_rows,
  round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.cy_data) x(k,v) WHERE substring(k,1,1)!='_' AND v ~ '^-?[0-9]'),0)::numeric,0) AS note_cy,
  round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.py_data) x(k,v) WHERE substring(k,1,1)!='_' AND v ~ '^-?[0-9]'),0)::numeric,0) AS note_py
FROM nce_financial_notes n
JOIN audit_engagements ae ON ae.id=n.engagement_id JOIN clients c ON c.id=ae.client_id
WHERE ae.financial_year='2025-26'
  AND (SELECT count(*) FROM jsonb_array_elements(coalesce(n.cy_data->'_custom_rows','[]'::jsonb)) e WHERE e->>'source'='manual') > 0
  AND abs(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.cy_data) x(k,v) WHERE substring(k,1,1)!='_' AND v ~ '^-?[0-9]'),0)) < 1
  AND abs(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.py_data) x(k,v) WHERE substring(k,1,1)!='_' AND v ~ '^-?[0-9]'),0)) < 1
ORDER BY manual_rows DESC LIMIT 20
