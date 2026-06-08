SELECT tb.ledger_name, tb.opening_balance, tb.opening_type,
       tb.closing_balance, tb.balance_type,
       tb.debit_amount, tb.credit_amount
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN tally_trial_balance tb ON tb.engagement_id = e.id
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND e.coa_mapping->tb.ledger_name->>'code' = 'BS_EQ_RS';
