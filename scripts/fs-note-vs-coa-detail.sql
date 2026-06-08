-- Detailed comparison: COA total vs Note total for trade_payables and other_cl
-- across ALL clients where there's a mismatch
-- Also check COGS notes

WITH nce_eng AS (
  SELECT e.id AS eid, c.name AS client, e.financial_year AS fy, e.coa_mapping
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
-- COA totals for trade_payables and other_cl codes (note-nature signed: Cr = positive)
coa_tp AS (
  SELECT ne.eid, ne.client,
    'trade_payables' AS note_type,
    ROUND(SUM(CASE WHEN UPPER(tb.balance_type)='CR' THEN ABS(tb.closing_balance) ELSE -ABS(tb.closing_balance) END)::numeric, 0) AS coa_total
  FROM nce_eng ne
  CROSS JOIN LATERAL jsonb_each(ne.coa_mapping) AS m(ledger_name, value)
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid AND tb.ledger_name = m.ledger_name
  WHERE m.value->>'code' IN ('NCE_TP','BS_CL_TP','BS_CL_TP_MSME','BS_CL_TP_OTH')
  GROUP BY ne.eid, ne.client
),
coa_ocl AS (
  SELECT ne.eid, ne.client,
    'other_cl' AS note_type,
    ROUND(SUM(CASE WHEN UPPER(tb.balance_type)='CR' THEN ABS(tb.closing_balance) ELSE -ABS(tb.closing_balance) END)::numeric, 0) AS coa_total
  FROM nce_eng ne
  CROSS JOIN LATERAL jsonb_each(ne.coa_mapping) AS m(ledger_name, value)
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid AND tb.ledger_name = m.ledger_name
  WHERE m.value->>'code' IN ('NCE_OCL','BS_CL_OCL')
  GROUP BY ne.eid, ne.client
),
-- Note totals from nce_financial_notes (sum all numeric keys except meta)
note_totals AS (
  SELECT ne.eid, ne.client, nfn.note_type,
    ROUND((SELECT COALESCE(SUM(v::numeric), 0) FROM jsonb_each_text(nfn.cy_data) kv(k,v)
     WHERE k NOT LIKE '\_%' AND k != 'total'
     AND v ~ '^-?[0-9]+\.?[0-9]*$')::numeric, 0) AS note_total,
    -- Count manual vs auto rows
    (SELECT count(*) FROM jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr
     WHERE cr->>'source' = 'manual') AS manual_rows,
    (SELECT count(*) FROM jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr
     WHERE cr->>'source' = 'auto') AS auto_rows
  FROM nce_eng ne
  JOIN nce_financial_notes nfn ON nfn.engagement_id = ne.eid AND nfn.financial_year = ne.fy
  WHERE nfn.note_type IN ('trade_payables', 'other_cl')
),
combined AS (
  SELECT c.client, c.note_type, c.coa_total,
    COALESCE(n.note_total, 0) AS note_total,
    c.coa_total - COALESCE(n.note_total, 0) AS diff,
    COALESCE(n.manual_rows, 0) AS manual_rows,
    COALESCE(n.auto_rows, 0) AS auto_rows
  FROM (SELECT * FROM coa_tp UNION ALL SELECT * FROM coa_ocl) c
  LEFT JOIN note_totals n ON n.eid = c.eid AND n.note_type = c.note_type
  WHERE ABS(c.coa_total) > 1
)
SELECT
  client, note_type,
  coa_total AS "COA",
  note_total AS "Note",
  diff AS "Diff (COA-Note)",
  manual_rows AS "Manual",
  auto_rows AS "Auto",
  CASE WHEN ABS(diff) < 2 THEN 'MATCH' ELSE 'MISMATCH' END AS status
FROM combined
WHERE ABS(diff) > 1
ORDER BY client, note_type;
