-- REV diagnostic for the 8 remaining notes: rows whose label matches NO
-- mapped ledger (per the note's code family) but carry non-zero values,
-- plus sources entries for unmapped ledgers.
WITH cmap(code, note_type) AS (
  VALUES ('NCE_LTB','borrowings'),('NCE_STB','borrowings'),('BS_NCL_LTB','borrowings'),('BS_CL_STB','borrowings'),
         ('NCE_TP','trade_payables'),('BS_CL_TP','trade_payables'),('BS_CL_TP_MSME','trade_payables'),('BS_CL_TP_OTH','trade_payables'),
         ('NCE_OCL','other_cl'),('BS_CL_OCL','other_cl'),
         ('NCE_TR','trade_receivables'),('BS_CA_TR','trade_receivables'),
         ('NCE_OTH_EXP','other_expenses'),('PL_EXP_OTH','other_expenses'),('PL_EXP_OEX','other_expenses')
),
targets AS (
  SELECT n.id, n.engagement_id, n.note_type, n.cy_data, n.py_data, c.name
  FROM nce_financial_notes n
  JOIN audit_engagements ae ON ae.id = n.engagement_id
  JOIN clients c ON c.id = ae.client_id
  WHERE (n.cy_data ? 'coa_reconcile_balance' OR n.cy_data ? 'coa_reconcile_balance_lt'
      OR n.py_data ? 'coa_reconcile_balance' OR n.py_data ? 'coa_reconcile_balance_lt')
),
mapped AS (
  SELECT t.id as note_id, lower(trim(je.key)) as lname
  FROM targets t
  JOIN audit_engagements ae ON ae.id = t.engagement_id
  CROSS JOIN LATERAL jsonb_each(ae.coa_mapping) je
  WHERE je.value->>'code' IN (SELECT code FROM cmap WHERE note_type = t.note_type)
),
rows_unmatched AS (
  SELECT t.name, t.note_type, e->>'label' as label, e->>'id' as id, e->>'source' as src,
    e->>'attachedTo' as att,
    coalesce((t.cy_data->>((e->>'id')||'_lt'))::numeric,0)+coalesce((t.cy_data->>((e->>'id')||'_st'))::numeric,0)+coalesce((t.cy_data->>(e->>'id'))::numeric,0) as row_cy,
    coalesce((t.py_data->>((e->>'id')||'_lt'))::numeric,0)+coalesce((t.py_data->>((e->>'id')||'_st'))::numeric,0)+coalesce((t.py_data->>(e->>'id'))::numeric,0) as row_py
  FROM targets t, jsonb_array_elements(t.cy_data->'_custom_rows') e
  WHERE e->>'id' <> 'coa_reconcile_balance'
    AND NOT EXISTS (SELECT 1 FROM mapped m WHERE m.note_id = t.id AND m.lname = lower(trim(e->>'label')))
)
SELECT * FROM rows_unmatched
WHERE abs(row_cy) > 1 OR abs(row_py) > 1
ORDER BY name, note_type, abs(row_cy)+abs(row_py) DESC
LIMIT 60
