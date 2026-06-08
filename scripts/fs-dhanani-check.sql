-- Check DHANANI REALTY: P&L A/c and all BS_EQ_RS-mapped ledgers
SELECT
  tb.ledger_name,
  tb.closing_balance,
  tb.balance_type,
  tb.opening_balance,
  tb.opening_type,
  tb.debit_amount,
  tb.credit_amount,
  tb.parent_group,
  e.coa_mapping->tb.ledger_name->>'code' AS fs_code
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN tally_trial_balance tb ON tb.engagement_id = e.id
WHERE c.name ILIKE '%Dhanani Realty%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND (
    e.coa_mapping->tb.ledger_name->>'code' = 'BS_EQ_RS'
    OR e.coa_mapping->tb.ledger_name->>'code' = 'NCE_CAP'
    OR LOWER(tb.ledger_name) LIKE '%profit%loss%'
  )
ORDER BY tb.ledger_name;
