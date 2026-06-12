-- AMBER finance_costs PY: which PY TB ledgers lower-match a finance_costs
-- mapping key but do NOT exact/trim match it (app's COA anchor misses them)?
WITH map AS (
  SELECT key, value->>'code' as code
  FROM audit_engagements ae, jsonb_each(ae.coa_mapping) je(key, value)
  WHERE ae.id='8b0b22b3-04a7-4225-a646-d9f5a842625a'
    AND je.value->>'code' IN ('NCE_FIN_COST','PL_EXP_FIN')
),
pytb AS (
  SELECT t.ledger_name, t.closing_balance, t.closing_type
  FROM tally_ledgers t
  WHERE t.engagement_id = (SELECT id FROM audit_engagements
                           WHERE client_id=(SELECT client_id FROM audit_engagements WHERE id='8b0b22b3-04a7-4225-a646-d9f5a842625a')
                             AND financial_year='2024-25' LIMIT 1)
)
SELECT p.ledger_name as py_tb_name, m.key as mapping_key, p.closing_balance, p.closing_type,
  (p.ledger_name = m.key) as exact, (trim(p.ledger_name) = m.key OR p.ledger_name = trim(m.key)) as trim_eq
FROM pytb p JOIN map m ON lower(trim(p.ledger_name)) = lower(trim(m.key))
WHERE p.ledger_name <> m.key
