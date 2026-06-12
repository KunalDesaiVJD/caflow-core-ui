-- CORPORATE TRACK SWEEP — stage5_notes breakup sums vs COA (app semantics:
-- TB-row iteration, exact→trim lookup). Skips is_group rows (mirrors
-- sumNotesSubRowsCY/PY). Exclusions mirroring app/structural exemptions:
-- PPE/FA grid, BS_EQ_RS (profit-absorbing reserve = capital-equivalent),
-- PL_EXP_CII (structural changes-in-inventories).
WITH corp_map(section, key, code, nature) AS (
  VALUES
    ('bs_liab','share_capital','BS_EQ_SC','CR'),
    ('bs_liab','lt_borrowings','BS_NCL_LTB','CR'),
    ('bs_liab','deferred_tax_liab','BS_NCL_DTL','CR'),
    ('bs_liab','other_lt_liab','BS_NCL_OLT','CR'),
    ('bs_liab','lt_provisions','BS_NCL_LTP','CR'),
    ('bs_liab','st_borrowings','BS_CL_STB','CR'),
    ('bs_liab','trade_payables','BS_CL_TP','CR'),
    ('bs_liab','other_current_liab','BS_CL_OCL','CR'),
    ('bs_liab','st_provisions','BS_CL_STP','CR'),
    ('bs_asset','nc_investments','BS_NCA_INV','DR'),
    ('bs_asset','deferred_tax_assets','BS_NCA_DTA','DR'),
    ('bs_asset','lt_loans_advances','BS_NCA_LLA','DR'),
    ('bs_asset','other_nc_assets','BS_NCA_ONA','DR'),
    ('bs_asset','current_investments','BS_CA_CI','DR'),
    ('bs_asset','inventories','BS_CA_INV','DR'),
    ('bs_asset','trade_receivables','BS_CA_TR','DR'),
    ('bs_asset','cash_bank','BS_CA_CCE','DR'),
    ('bs_asset','st_loans_advances','BS_CA_SLA','DR'),
    ('bs_asset','other_current_assets','BS_CA_OCA','DR'),
    ('pl','revenue_from_ops','PL_REV_OPS','CR'),
    ('pl','other_income','PL_REV_OI','CR'),
    ('pl','cost_materials','PL_EXP_MAT','DR'),
    ('pl','purchases_stock','PL_EXP_SIT','DR'),
    ('pl','employee_benefits','PL_EXP_EMP','DR'),
    ('pl','finance_costs','PL_EXP_FIN','DR'),
    ('pl','other_expenses','PL_EXP_OTH','DR')
),
eng AS (
  SELECT ae.id, ae.client_id, ae.financial_year, ae.coa_mapping, ae.stage5_notes, c.name
  FROM audit_engagements ae JOIN clients c ON c.id = ae.client_id
  WHERE ae.stage5_notes IS NOT NULL
    AND c.entity_type IN ('Private Ltd','Public Ltd','company')
    AND coalesce(ae.is_py_shell,false) = false
),
pye AS (
  SELECT e.id as eng_id, prior.id as py_id
  FROM eng e
  LEFT JOIN audit_engagements prior
    ON prior.client_id = e.client_id
   AND prior.financial_year = (split_part(e.financial_year,'-',1)::int - 1)::text
       || '-' || lpad(((split_part(e.financial_year,'-',1)::int) % 100)::text, 2, '0')
),
coa_cy AS (
  SELECT e.id as eng_id, cm.section, cm.key,
    round(sum(CASE WHEN upper(coalesce(t.closing_type,''))=cm.nature
                   THEN abs(coalesce(t.closing_balance::numeric,0))
                   ELSE -abs(coalesce(t.closing_balance::numeric,0)) END)::numeric,2) as coa_cy,
    round(sum(CASE WHEN upper(coalesce(t.opening_type,''))=cm.nature
                   THEN abs(coalesce(t.opening_balance::numeric,0))
                   ELSE -abs(coalesce(t.opening_balance::numeric,0)) END)::numeric,2) as coa_open
  FROM eng e
  JOIN tally_ledgers t ON t.engagement_id = e.id
  CROSS JOIN LATERAL (
    SELECT coalesce(e.coa_mapping->t.ledger_name, e.coa_mapping->trim(t.ledger_name)) as info
  ) m
  JOIN corp_map cm ON cm.code = m.info->>'code'
  WHERE m.info IS NOT NULL
  GROUP BY e.id, cm.section, cm.key
),
coa_py AS (
  SELECT e.id as eng_id, cm.section, cm.key,
    round(sum(CASE WHEN upper(coalesce(t.closing_type,''))=cm.nature
                   THEN abs(coalesce(t.closing_balance::numeric,0))
                   ELSE -abs(coalesce(t.closing_balance::numeric,0)) END)::numeric,2) as coa_py
  FROM eng e
  JOIN pye p ON p.eng_id = e.id AND p.py_id IS NOT NULL
  JOIN tally_ledgers t ON t.engagement_id = p.py_id
  CROSS JOIN LATERAL (
    SELECT coalesce(e.coa_mapping->t.ledger_name, e.coa_mapping->trim(t.ledger_name)) as info
  ) m
  JOIN corp_map cm ON cm.code = m.info->>'code'
  WHERE m.info IS NOT NULL
  GROUP BY e.id, cm.section, cm.key
),
notes AS (
  SELECT e.id as eng_id, cm.section, cm.key,
    (SELECT round(sum((b->>'amount_cy')::numeric)::numeric,2)
     FROM jsonb_array_elements(coalesce(e.stage5_notes->cm.section->cm.key->'breakup','[]'::jsonb)) b
     WHERE coalesce((b->>'is_group')::boolean,false) = false
       AND b->>'amount_cy' ~ '^-?[0-9.]+$') as note_cy,
    (SELECT round(sum((b->>'amount_py')::numeric)::numeric,2)
     FROM jsonb_array_elements(coalesce(e.stage5_notes->cm.section->cm.key->'breakup','[]'::jsonb)) b
     WHERE coalesce((b->>'is_group')::boolean,false) = false
       AND b->>'amount_py' ~ '^-?[0-9.]+$') as note_py
  FROM eng e CROSS JOIN (SELECT DISTINCT section, key FROM corp_map) cm
)
SELECT e.name, e.financial_year, e.id as engagement_id, n.section, n.key,
  cc.coa_cy, n.note_cy, round(coalesce(cc.coa_cy,0) - coalesce(n.note_cy,0),2) as delta_cy,
  CASE WHEN p.py_id IS NOT NULL THEN cp.coa_py ELSE cc.coa_open END as coa_py,
  n.note_py,
  round(coalesce(CASE WHEN p.py_id IS NOT NULL THEN cp.coa_py ELSE cc.coa_open END,0)
        - coalesce(n.note_py,0),2) as delta_py
FROM eng e
JOIN pye p ON p.eng_id = e.id
JOIN notes n ON n.eng_id = e.id
LEFT JOIN coa_cy cc ON cc.eng_id=e.id AND cc.section=n.section AND cc.key=n.key
LEFT JOIN coa_py cp ON cp.eng_id=e.id AND cp.section=n.section AND cp.key=n.key
WHERE n.note_cy IS NOT NULL OR n.note_py IS NOT NULL OR cc.coa_cy IS NOT NULL
ORDER BY e.name, n.section, n.key
