-- Every TB ledger mapped to an other_expenses code, with signed amount
SELECT
  tb.ledger_name,
  tb.parent_group,
  tb.closing_balance,
  tb.balance_type,
  e.coa_mapping->tb.ledger_name->>'code' AS fs_code
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN tally_trial_balance tb ON tb.engagement_id = e.id
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND e.coa_mapping->tb.ledger_name->>'code' IN ('NCE_OTH_EXP','PL_EXP_OTH','PL_EXP_OEX')
  AND ABS(COALESCE(tb.closing_balance,0)) > 0.005
ORDER BY tb.ledger_name;
