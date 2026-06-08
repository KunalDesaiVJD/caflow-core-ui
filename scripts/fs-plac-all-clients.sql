-- Check P&L A/c closing balance for ALL 11 clients
-- To verify which ones need auto-credit vs which ones already have profit in capital
SELECT
  c.name AS client,
  tb.ledger_name,
  tb.closing_balance,
  tb.balance_type,
  tb.debit_amount,
  tb.credit_amount,
  CASE
    WHEN ABS(COALESCE(tb.closing_balance,0)) > 0.005 THEN 'NON-ZERO → needs auto-credit'
    ELSE 'ZERO → profit already in capital (NO auto-credit)'
  END AS status
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN tally_trial_balance tb ON tb.engagement_id = e.id
WHERE c.name ILIKE ANY(ARRAY[
    '%DBS Realty%','%Shree Hari Infra%','%Bhakti Infra%','%Maharsh Infra%',
    '%Shree Maruti Infra%','%Revti Infra%','%Shivashray%','%Salient Infratech%',
    '%Bapasitaram%','%Dhanani Realty%','%Shri Ram Products%'
  ])
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND e.coa_mapping->tb.ledger_name->>'code' = 'BS_EQ_RS'
ORDER BY c.name;
