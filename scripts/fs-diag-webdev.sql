-- Find "Web Developing Fees Exp" in SHRI RAM PRODUCTS TB + COA mapping
SELECT
  tb.ledger_name,
  tb.closing_balance,
  tb.balance_type,
  tb.opening_balance,
  tb.opening_type,
  tb.parent_group,
  e.coa_mapping->tb.ledger_name->>'code' AS fs_code
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN tally_trial_balance tb ON tb.engagement_id = e.id
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND (
    tb.ledger_name ILIKE '%web%'
    OR tb.ledger_name ILIKE '%developing%'
    OR tb.ledger_name ILIKE '%website%'
  )
ORDER BY tb.ledger_name;
