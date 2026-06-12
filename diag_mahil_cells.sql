-- MAHIL drifted cells per the deduped sweep
WITH code_map(code, note_type, nature) AS (
  VALUES
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
    ('BS_NCL_LTB','borrowings','CR'), ('BS_CL_STB','borrowings','CR'),
    ('PL_EXP_OTH','other_expenses','DR'), ('PL_EXP_OEX','other_expenses','DR')
),
eng AS (SELECT 'e11aebd4-6e1e-481c-90dc-7dff556dc5cb'::uuid as id),
pye AS (SELECT ae.id FROM audit_engagements ae WHERE ae.client_id=(SELECT client_id FROM audit_engagements WHERE id=(SELECT id FROM eng)) AND ae.financial_year='2024-25' LIMIT 1),
coa_per AS (
  SELECT DISTINCT ON (lower(trim(lname))) lname as ledger_name, (info->>'code') as code
  FROM audit_engagements ae, jsonb_each(ae.coa_mapping) m(lname, info)
  WHERE ae.id=(SELECT id FROM eng) AND info->>'code' IS NOT NULL
  ORDER BY lower(trim(lname)), lname
),
joined AS (
  SELECT cm.note_type, cm.nature,
    tc.closing_balance::numeric as cy_amt, tc.closing_type as cy_type,
    tp.closing_balance::numeric as py_amt, tp.closing_type as py_type
  FROM coa_per cpe
  JOIN code_map cm ON cm.code = cpe.code
  LEFT JOIN tally_ledgers tc ON tc.engagement_id=(SELECT id FROM eng) AND lower(trim(tc.ledger_name))=lower(trim(cpe.ledger_name))
  LEFT JOIN tally_ledgers tp ON tp.engagement_id=(SELECT id FROM pye) AND lower(trim(tp.ledger_name))=lower(trim(cpe.ledger_name))
),
coa_t AS (
  SELECT note_type,
    round(sum(CASE WHEN cy_amt IS NULL THEN 0
                   WHEN upper(coalesce(cy_type,''))=nature THEN abs(cy_amt) ELSE -abs(cy_amt) END)::numeric,2) as coa_cy,
    round(sum(CASE WHEN py_amt IS NULL THEN 0
                   WHEN upper(coalesce(py_type,''))=nature THEN abs(py_amt) ELSE -abs(py_amt) END)::numeric,2) as coa_py
  FROM joined GROUP BY note_type
),
note_t AS (
  SELECT n.note_type,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.cy_data) x(k,v) WHERE substring(k,1,1)!='_' AND v ~ '^-?[0-9]'),0)::numeric,2) as note_cy,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.py_data) x(k,v) WHERE substring(k,1,1)!='_' AND v ~ '^-?[0-9]'),0)::numeric,2) as note_py
  FROM nce_financial_notes n WHERE n.engagement_id=(SELECT id FROM eng)
)
SELECT c.note_type, c.coa_cy, coalesce(n.note_cy,0) as note_cy, round(c.coa_cy-coalesce(n.note_cy,0),0) as dcy,
       c.coa_py, coalesce(n.note_py,0) as note_py, round(c.coa_py-coalesce(n.note_py,0),0) as dpy
FROM coa_t c LEFT JOIN note_t n ON n.note_type=c.note_type
WHERE abs(c.coa_cy-coalesce(n.note_cy,0)) > 1 OR abs(c.coa_py-coalesce(n.note_py,0)) > 1
ORDER BY c.note_type
