-- Compute note total INCLUDING sources (replicating computeNoteTotals logic)
-- For each note: sum numeric keys + sum sources where raw[id] = 0

WITH nce_eng AS (
  SELECT e.id AS eid, c.name AS client, e.financial_year AS fy
  FROM audit_engagements e
  JOIN clients c ON c.id = e.client_id
  WHERE c.name ILIKE ANY(ARRAY[
    '%DBS Realty%','%Shree Hari Infra%','%Bhakti Infra%','%Maharsh Infra%',
    '%Shree Maruti Infra%','%Revti Infra%','%Shivashray%','%Salient Infratech%',
    '%Bapasitaram%','%Dhanani Realty%','%Shri Ram Products%'
  ])
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
),
note_with_sources AS (
  SELECT
    ne.client,
    nfn.note_type,
    -- Sum flat numeric keys
    (SELECT COALESCE(SUM(v::numeric), 0) FROM jsonb_each_text(nfn.cy_data) kv(k,v)
     WHERE k NOT LIKE '\_%' AND k != 'total'
     AND v ~ '^-?[0-9]+\.?[0-9]*$') AS flat_sum,
    -- Sum sources from custom rows where flat value = 0
    (SELECT COALESCE(SUM((s->>'amountCy')::numeric), 0)
     FROM jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr,
     LATERAL jsonb_array_elements(COALESCE(cr->'sources','[]'::jsonb)) s
     WHERE COALESCE((nfn.cy_data->>(cr->>'id'))::numeric, 0) = 0
    ) AS sources_sum
  FROM nce_eng ne
  JOIN nce_financial_notes nfn ON nfn.engagement_id = ne.eid AND nfn.financial_year = ne.fy
  WHERE nfn.note_type IN ('other_cl', 'trade_payables')
)
SELECT
  client, note_type,
  ROUND(flat_sum::numeric, 0) AS "Flat Keys",
  ROUND(sources_sum::numeric, 0) AS "Sources",
  ROUND((flat_sum + sources_sum)::numeric, 0) AS "Total (incl sources)"
FROM note_with_sources
WHERE ABS(flat_sum) > 1 OR ABS(sources_sum) > 1
ORDER BY client, note_type;
