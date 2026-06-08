-- Compare COA Mapping totals vs Note totals for ALL NCE clients, ALL notes
-- This is the definitive check: does every note total match its COA total?

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
-- COA totals per FS code per client (signed debit-positive)
coa_by_code AS (
  SELECT
    ne.eid, ne.client,
    m.value->>'code' AS fs_code,
    SUM(CASE WHEN UPPER(COALESCE(tb.balance_type,''))='DR'
      THEN ABS(COALESCE(tb.closing_balance,0))
      ELSE -ABS(COALESCE(tb.closing_balance,0)) END) AS coa_cy
  FROM nce_eng ne
  CROSS JOIN LATERAL jsonb_each(ne.coa_mapping) AS m(ledger_name, value)
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid AND tb.ledger_name = m.ledger_name
  WHERE m.value->>'code' IS NOT NULL
  GROUP BY ne.eid, ne.client, m.value->>'code'
),
-- Map FS codes to note types
code_to_note AS (
  SELECT unnest AS fs_code, note_type FROM (VALUES
    ('NCE_LTB','borrowings'),('BS_NCL_LTB','borrowings'),
    ('NCE_STB','borrowings'),('BS_CL_STB','borrowings'),
    ('NCE_OLTL','other_lt_liab'),('BS_NCL_OLT','other_lt_liab'),('BS_NCL_DTL','other_lt_liab'),
    ('NCE_LTP','provisions'),('BS_NCL_LTP','provisions'),
    ('NCE_STP','provisions'),('BS_CL_STP','provisions'),
    ('NCE_TP','trade_payables'),('BS_CL_TP','trade_payables'),
    ('NCE_OCL','other_cl'),('BS_CL_OCL','other_cl'),
    ('NCE_CWIP','cwip'),
    ('NCE_NCINV','investments'),('BS_NCA_INV','investments'),
    ('NCE_CINV','investments'),('BS_CA_CI','investments'),
    ('NCE_LTLA','loans_advances'),('BS_NCA_LLA','loans_advances'),
    ('NCE_STLA','loans_advances'),('BS_CA_SLA','loans_advances'),
    ('NCE_ONCA','other_nc_assets'),('BS_NCA_ONA','other_nc_assets'),('BS_NCA_DTA','other_nc_assets'),
    ('NCE_STCK','inventories'),('BS_CA_INV','inventories'),
    ('NCE_TR','trade_receivables'),('BS_CA_TR','trade_receivables'),
    ('NCE_CASH','cash_bank'),('BS_CA_CCE','cash_bank'),
    ('NCE_OCA','other_ca'),('BS_CA_OCA','other_ca'),
    ('NCE_REV_OPS','revenue_ops'),('PL_REV_OPS','revenue_ops'),
    ('NCE_REV_OTH','other_income'),('PL_REV_OI','other_income'),
    ('NCE_COGS','cogs'),('NCE_CII','cogs'),('PL_EXP_MAT','cogs'),('PL_EXP_SIT','cogs'),('PL_EXP_CII','cogs'),
    ('NCE_EMP_EXP','employee_exp'),('PL_EXP_EMP','employee_exp'),
    ('NCE_FIN_COST','finance_costs'),('PL_EXP_FIN','finance_costs'),
    ('NCE_OTH_EXP','other_expenses'),('PL_EXP_OTH','other_expenses'),('PL_EXP_OEX','other_expenses')
  ) AS t(unnest, note_type)
),
-- COA totals per NOTE TYPE (aggregating all FS codes that map to same note)
coa_by_note AS (
  SELECT
    cc.eid, cc.client, cn.note_type,
    ROUND(SUM(cc.coa_cy)::numeric, 0) AS coa_cy
  FROM coa_by_code cc
  JOIN code_to_note cn ON cn.fs_code = cc.fs_code
  GROUP BY cc.eid, cc.client, cn.note_type
),
-- Note row counts from nce_financial_notes
note_rows AS (
  SELECT
    ne.eid, ne.client,
    nfn.note_type,
    jsonb_array_length(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) AS row_count,
    nfn.updated_at
  FROM nce_eng ne
  JOIN nce_financial_notes nfn ON nfn.engagement_id = ne.eid AND nfn.financial_year = ne.fy
),
-- TB row count per client (to flag >1000 truncation risk)
tb_counts AS (
  SELECT ne.eid, ne.client, COUNT(*) AS tb_rows
  FROM nce_eng ne
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid
  GROUP BY ne.eid, ne.client
)
SELECT
  cn.client,
  cn.note_type,
  cn.coa_cy,
  nr.row_count AS note_rows,
  tc.tb_rows,
  CASE WHEN tc.tb_rows > 1000 THEN 'TRUNCATION RISK' ELSE 'OK' END AS tb_status
FROM coa_by_note cn
LEFT JOIN note_rows nr ON nr.eid = cn.eid AND nr.note_type = cn.note_type
LEFT JOIN tb_counts tc ON tc.eid = cn.eid
WHERE ABS(cn.coa_cy) > 1
ORDER BY cn.client, cn.note_type;
