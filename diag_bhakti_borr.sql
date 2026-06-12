-- BHAKTI borrowings: per-ledger expected vs note rows (Pattern A — _lt keys)
WITH note AS (
  SELECT n.* FROM nce_financial_notes n
  WHERE n.engagement_id='9dfac4d8-8e1a-4b7e-b40d-8ee2562d8dac' AND n.note_type='borrowings'
),
ledgers AS (
  SELECT je.key as ledger, je.value->>'code' as code
  FROM audit_engagements ae, jsonb_each(ae.coa_mapping) je
  WHERE ae.id='9dfac4d8-8e1a-4b7e-b40d-8ee2562d8dac'
    AND je.value->>'code' IN ('NCE_LTB','NCE_STB','BS_NCL_LTB','BS_CL_STB')
),
expected AS (
  SELECT l.ledger, l.code,
    coalesce((SELECT CASE WHEN upper(t.closing_type)='CR' THEN t.closing_balance::numeric ELSE -t.closing_balance::numeric END
              FROM tally_ledgers t WHERE t.engagement_id='9dfac4d8-8e1a-4b7e-b40d-8ee2562d8dac'
                AND lower(t.ledger_name)=lower(l.ledger) LIMIT 1),0) as ecy
  FROM ledgers l
),
crow AS (
  SELECT lower(trim(e->>'label')) as label, e->>'id' as id, e->>'source' as src, e->>'attachedTo' as att, e->>'section' as sec
  FROM note, jsonb_array_elements(note.cy_data->'_custom_rows') e
  WHERE e->>'id' != 'coa_reconcile_balance'
),
-- pass 1: mapped ledgers vs rows
fwd AS (
  SELECT x.ledger, x.ecy,
    (SELECT cr.id FROM crow cr WHERE cr.label = lower(trim(x.ledger)) LIMIT 1) as row_id,
    coalesce((SELECT coalesce((note.cy_data->>(cr.id||'_lt'))::numeric,0) + coalesce((note.cy_data->>(cr.id||'_st'))::numeric,0) + coalesce((note.cy_data->>cr.id)::numeric,0)
              FROM crow cr WHERE cr.label = lower(trim(x.ledger)) LIMIT 1),0) as row_cy
  FROM expected x, note
),
-- pass 2: rows with no mapped ledger
rev AS (
  SELECT cr.id, cr.label, cr.src, cr.att, cr.sec,
    coalesce((note.cy_data->>(cr.id||'_lt'))::numeric,0) + coalesce((note.cy_data->>(cr.id||'_st'))::numeric,0) + coalesce((note.cy_data->>cr.id)::numeric,0) as row_cy,
    coalesce((note.py_data->>(cr.id||'_lt'))::numeric,0) + coalesce((note.py_data->>(cr.id||'_st'))::numeric,0) + coalesce((note.py_data->>cr.id)::numeric,0) as row_py
  FROM crow cr, note
  WHERE NOT EXISTS (SELECT 1 FROM ledgers l WHERE lower(trim(l.ledger)) = cr.label)
)
SELECT 'FWD' as pass, ledger as item, ecy as expected_cy, row_cy, round((ecy-row_cy)::numeric,2) as delta, null as src
FROM fwd WHERE abs(ecy - row_cy) > 1
UNION ALL
SELECT 'REV', label, null, row_cy, row_py, src FROM rev WHERE abs(row_cy) > 1 OR abs(row_py) > 1
ORDER BY 1, 2
