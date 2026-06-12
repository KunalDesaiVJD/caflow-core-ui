-- SECOND-OPINION SWEEP — independent construction, APP semantics:
-- iterate TB ROWS (not mapping keys); lookup = exact name, then trimmed;
-- legacy codes folded; covers EVERY engagement that has nce notes (any FY);
-- PY = prior-FY same-client TB closing, else CY opening fallback.
WITH code_map(code, note_type, nature) AS (
  VALUES
    ('NCE_LTB','borrowings','CR'), ('NCE_STB','borrowings','CR'),
    ('BS_NCL_LTB','borrowings','CR'), ('BS_CL_STB','borrowings','CR'),
    ('NCE_OLTL','other_lt_liab','CR'), ('BS_NCL_OLT','other_lt_liab','CR'), ('BS_NCL_DTL','other_lt_liab','CR'),
    ('NCE_LTP','provisions','CR'), ('NCE_STP','provisions','CR'),
    ('BS_NCL_LTP','provisions','CR'), ('BS_CL_STP','provisions','CR'),
    ('NCE_TP','trade_payables','CR'), ('BS_CL_TP','trade_payables','CR'),
    ('BS_CL_TP_MSME','trade_payables','CR'), ('BS_CL_TP_OTH','trade_payables','CR'),
    ('NCE_OCL','other_cl','CR'), ('BS_CL_OCL','other_cl','CR'),
    ('NCE_CWIP','cwip','DR'), ('BS_NCA_FA_WIP','cwip','DR'),
    ('NCE_NCINV','investments','DR'), ('NCE_CINV','investments','DR'),
    ('BS_NCA_INV','investments','DR'), ('BS_CA_CI','investments','DR'),
    ('NCE_LTLA','loans_advances','DR'), ('NCE_STLA','loans_advances','DR'),
    ('BS_NCA_LLA','loans_advances','DR'), ('BS_CA_SLA','loans_advances','DR'),
    ('NCE_ONCA','other_nc_assets','DR'), ('BS_NCA_ONA','other_nc_assets','DR'), ('BS_NCA_DTA','other_nc_assets','DR'),
    ('NCE_TR','trade_receivables','DR'), ('BS_CA_TR','trade_receivables','DR'),
    ('NCE_CASH','cash_bank','DR'), ('BS_CA_CCE','cash_bank','DR'),
    ('NCE_OCA','other_ca','DR'), ('BS_CA_OCA','other_ca','DR'),
    ('NCE_REV_OPS','revenue_ops','CR'), ('PL_REV_OPS','revenue_ops','CR'),
    ('NCE_REV_OTH','other_income','CR'), ('PL_REV_OI','other_income','CR'),
    ('NCE_EMP_EXP','employee_exp','DR'), ('PL_EXP_EMP','employee_exp','DR'),
    ('NCE_FIN_COST','finance_costs','DR'), ('PL_EXP_FIN','finance_costs','DR'),
    ('NCE_OTH_EXP','other_expenses','DR'), ('PL_EXP_OTH','other_expenses','DR'), ('PL_EXP_OEX','other_expenses','DR')
),
eng AS (
  SELECT DISTINCT ae.id, ae.client_id, ae.financial_year, ae.coa_mapping, c.name
  FROM audit_engagements ae
  JOIN clients c ON c.id = ae.client_id
  WHERE EXISTS (SELECT 1 FROM nce_financial_notes n WHERE n.engagement_id = ae.id)
),
pye AS (
  SELECT e.id as eng_id, prior.id as py_id
  FROM eng e
  LEFT JOIN audit_engagements prior
    ON prior.client_id = e.client_id
   AND prior.financial_year = (split_part(e.financial_year,'-',1)::int - 1)::text
       || '-' || lpad(((split_part(e.financial_year,'-',1)::int) % 100)::text, 2, '0')
),
-- APP SEMANTICS: iterate CY TB rows; resolve mapping exact → trimmed
cy_rows AS (
  SELECT e.id as eng_id, cm.note_type, cm.nature,
    CASE WHEN upper(coalesce(t.closing_type,'')) = cm.nature
         THEN abs(coalesce(t.closing_balance::numeric,0))
         ELSE -abs(coalesce(t.closing_balance::numeric,0)) END as scy,
    CASE WHEN upper(coalesce(t.opening_type,'')) = cm.nature
         THEN abs(coalesce(t.opening_balance::numeric,0))
         ELSE -abs(coalesce(t.opening_balance::numeric,0)) END as sopen
  FROM eng e
  JOIN tally_ledgers t ON t.engagement_id = e.id
  CROSS JOIN LATERAL (
    SELECT coalesce(e.coa_mapping->t.ledger_name, e.coa_mapping->trim(t.ledger_name)) as info
  ) m
  JOIN code_map cm ON cm.code = m.info->>'code'
  WHERE m.info IS NOT NULL
),
py_rows AS (
  SELECT e.id as eng_id, cm.note_type,
    CASE WHEN upper(coalesce(t.closing_type,'')) = cm.nature
         THEN abs(coalesce(t.closing_balance::numeric,0))
         ELSE -abs(coalesce(t.closing_balance::numeric,0)) END as spy
  FROM eng e
  JOIN pye p ON p.eng_id = e.id AND p.py_id IS NOT NULL
  JOIN tally_ledgers t ON t.engagement_id = p.py_id
  CROSS JOIN LATERAL (
    SELECT coalesce(e.coa_mapping->t.ledger_name, e.coa_mapping->trim(t.ledger_name)) as info
  ) m
  JOIN code_map cm ON cm.code = m.info->>'code'
  WHERE m.info IS NOT NULL
),
coa AS (
  SELECT c.eng_id, c.note_type,
    round(sum(c.scy)::numeric,2) as coa_cy,
    CASE WHEN max(p2.py_id::text) IS NOT NULL
         THEN coalesce((SELECT round(sum(pr.spy)::numeric,2) FROM py_rows pr
                        WHERE pr.eng_id=c.eng_id AND pr.note_type=c.note_type), 0)
         ELSE round(sum(c.sopen)::numeric,2) END as coa_py
  FROM cy_rows c
  JOIN pye p2 ON p2.eng_id = c.eng_id
  GROUP BY c.eng_id, c.note_type
),
notes AS (
  SELECT n.engagement_id as eng_id, n.note_type,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.cy_data) x(k,v)
                    WHERE substring(k,1,1) != '_' AND v ~ '^-?[0-9]'),0)::numeric, 2) as note_cy,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.py_data) x(k,v)
                    WHERE substring(k,1,1) != '_' AND v ~ '^-?[0-9]'),0)::numeric, 2) as note_py
  FROM nce_financial_notes n
  WHERE n.engagement_id IN (SELECT id FROM eng)
    AND n.note_type IN (SELECT DISTINCT note_type FROM code_map)
)
SELECT e.name, e.financial_year, e.id as engagement_id,
  coalesce(c.note_type, nt.note_type) as note_type,
  coalesce(c.coa_cy,0) as coa_cy, coalesce(nt.note_cy,0) as note_cy,
  round(coalesce(c.coa_cy,0) - coalesce(nt.note_cy,0), 2) as delta_cy,
  coalesce(c.coa_py,0) as coa_py, coalesce(nt.note_py,0) as note_py,
  round(coalesce(c.coa_py,0) - coalesce(nt.note_py,0), 2) as delta_py
FROM eng e
LEFT JOIN coa c ON c.eng_id = e.id
FULL OUTER JOIN notes nt ON nt.eng_id = c.eng_id AND nt.note_type = c.note_type
WHERE coalesce(c.eng_id, nt.eng_id) = e.id
ORDER BY e.name, 4
