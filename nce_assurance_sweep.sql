-- Full-book NCE assurance sweep — one row per FY 2025-26 NCE engagement.
-- Columns: client, notes_total, in-scope drift cells CY/PY (>₹1), worst drift,
-- excluded-by-design cells (cogs/inventories). BS balance is enforced
-- structurally in code (residual absorber) — COA-level Dr/Cr gap shown for info.
WITH code_map(code, note_type, nature) AS (
  VALUES
    -- canonical NCE codes
    ('NCE_LTB','borrowings','CR'), ('NCE_STB','borrowings','CR'),
    ('NCE_OLTL','other_lt_liab','CR'),
    ('NCE_LTP','provisions','CR'), ('NCE_STP','provisions','CR'),
    ('NCE_TP','trade_payables','CR'), ('NCE_OCL','other_cl','CR'),
    ('NCE_CWIP','cwip','DR'),
    ('NCE_NCINV','investments','DR'), ('NCE_CINV','investments','DR'),
    ('NCE_LTLA','loans_advances','DR'), ('NCE_STLA','loans_advances','DR'),
    ('NCE_ONCA','other_nc_assets','DR'),
    ('NCE_TR','trade_receivables','DR'), ('NCE_CASH','cash_bank','DR'),
    ('NCE_OCA','other_ca','DR'),
    ('NCE_REV_OPS','revenue_ops','CR'), ('NCE_REV_OTH','other_income','CR'),
    ('NCE_EMP_EXP','employee_exp','DR'), ('NCE_FIN_COST','finance_costs','DR'),
    ('NCE_OTH_EXP','other_expenses','DR'),
    -- legacy corporate codes accepted by NCE_NOTE_FS_MAP (fold into same note)
    ('BS_NCL_LTB','borrowings','CR'), ('BS_CL_STB','borrowings','CR'),
    ('BS_NCL_OLT','other_lt_liab','CR'), ('BS_NCL_DTL','other_lt_liab','CR'),
    ('BS_NCL_LTP','provisions','CR'), ('BS_CL_STP','provisions','CR'),
    ('BS_CL_TP','trade_payables','CR'), ('BS_CL_TP_MSME','trade_payables','CR'),
    ('BS_CL_TP_OTH','trade_payables','CR'),
    ('BS_CL_OCL','other_cl','CR'),
    ('BS_NCA_FA_WIP','cwip','DR'),
    ('BS_NCA_INV','investments','DR'), ('BS_CA_CI','investments','DR'),
    ('BS_NCA_LLA','loans_advances','DR'), ('BS_CA_SLA','loans_advances','DR'),
    ('BS_NCA_ONA','other_nc_assets','DR'), ('BS_NCA_DTA','other_nc_assets','DR'),
    ('BS_CA_TR','trade_receivables','DR'), ('BS_CA_CCE','cash_bank','DR'),
    ('BS_CA_OCA','other_ca','DR'),
    ('PL_REV_OPS','revenue_ops','CR'), ('PL_REV_OI','other_income','CR'),
    ('PL_EXP_EMP','employee_exp','DR'), ('PL_EXP_FIN','finance_costs','DR'),
    ('PL_EXP_OTH','other_expenses','DR'), ('PL_EXP_OEX','other_expenses','DR')
),
nce_clients AS (
  SELECT id, name FROM clients WHERE entity_type IN
    ('Partnership','Individual','HUF','AOP','Trust','LLP','Proprietorship')
),
cy_eng AS (
  SELECT ae.id, ae.client_id, ae.coa_mapping, c.name
  FROM audit_engagements ae JOIN nce_clients c ON c.id=ae.client_id
  WHERE ae.financial_year='2025-26'
),
py_eng AS (
  SELECT ae.id as py_id, ae.client_id
  FROM audit_engagements ae JOIN nce_clients c ON c.id=ae.client_id
  WHERE ae.financial_year='2024-25'
),
coa_per_eng AS (
  SELECT ce.id as engagement_id, lname as ledger_name, (info->>'code') as code
  FROM cy_eng ce, jsonb_each(ce.coa_mapping) m(lname, info)
  WHERE info->>'code' IS NOT NULL
),
joined AS (
  SELECT cpe.engagement_id, cm.note_type, cm.nature,
    tc.closing_balance::numeric as cy_amt, tc.closing_type as cy_type,
    tp.closing_balance::numeric as py_amt, tp.closing_type as py_type
  FROM coa_per_eng cpe
  JOIN code_map cm ON cm.code = cpe.code
  JOIN cy_eng ce ON ce.id = cpe.engagement_id
  LEFT JOIN py_eng pe ON pe.client_id = ce.client_id
  LEFT JOIN tally_ledgers tc ON tc.engagement_id = cpe.engagement_id
       AND lower(tc.ledger_name) = lower(cpe.ledger_name)
  LEFT JOIN tally_ledgers tp ON tp.engagement_id = pe.py_id
       AND lower(tp.ledger_name) = lower(cpe.ledger_name)
),
coa_totals AS (
  SELECT engagement_id, note_type,
    round(sum(CASE WHEN cy_amt IS NULL THEN 0
                   WHEN upper(coalesce(cy_type,'')) = nature THEN abs(cy_amt)
                   WHEN upper(coalesce(cy_type,'')) = '' THEN CASE WHEN nature='CR' THEN abs(cy_amt) ELSE -abs(cy_amt) END
                   ELSE -abs(cy_amt) END)::numeric, 2) as coa_cy,
    round(sum(CASE WHEN py_amt IS NULL THEN 0
                   WHEN upper(coalesce(py_type,'')) = nature THEN abs(py_amt)
                   WHEN upper(coalesce(py_type,'')) = '' THEN CASE WHEN nature='CR' THEN abs(py_amt) ELSE -abs(py_amt) END
                   ELSE -abs(py_amt) END)::numeric, 2) as coa_py
  FROM joined GROUP BY engagement_id, note_type
),
note_totals AS (
  SELECT n.engagement_id, n.note_type,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.cy_data) x(k,v)
                    WHERE substring(k,1,1) != '_' AND v ~ '^-?[0-9]'),0)::numeric, 2) as note_cy,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.py_data) x(k,v)
                    WHERE substring(k,1,1) != '_' AND v ~ '^-?[0-9]'),0)::numeric, 2) as note_py
  FROM nce_financial_notes n
  WHERE n.engagement_id IN (SELECT id FROM cy_eng)
),
cells AS (
  SELECT ct.engagement_id, ct.note_type,
    abs(ct.coa_cy - coalesce(nt.note_cy,0)) as dcy,
    abs(ct.coa_py - coalesce(nt.note_py,0)) as dpy
  FROM coa_totals ct
  LEFT JOIN note_totals nt ON nt.engagement_id=ct.engagement_id AND nt.note_type=ct.note_type
)
SELECT
  ce.name as client,
  ce.id as engagement_id,
  (SELECT count(*) FROM nce_financial_notes n WHERE n.engagement_id=ce.id) as notes,
  coalesce((SELECT count(*) FROM cells x WHERE x.engagement_id=ce.id AND x.dcy > 1), 0) as drift_cy,
  coalesce((SELECT count(*) FROM cells x WHERE x.engagement_id=ce.id AND x.dpy > 1), 0) as drift_py,
  coalesce((SELECT round(max(greatest(x.dcy, x.dpy))::numeric,0) FROM cells x WHERE x.engagement_id=ce.id), 0) as worst_drift,
  CASE WHEN EXISTS (SELECT 1 FROM py_eng pe WHERE pe.client_id=ce.client_id) THEN 'Y' ELSE 'N' END as has_py
FROM cy_eng ce
ORDER BY ce.name
