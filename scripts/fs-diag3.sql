SELECT
  c.name AS client,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE tb.balance_type IS NULL) AS null_bal_type,
  COUNT(*) FILTER (WHERE tb.closing_balance IS NULL) AS null_closing,
  ROUND(SUM(CASE WHEN tb.balance_type='Dr' THEN COALESCE(tb.closing_balance,0)
            WHEN tb.balance_type='Cr' THEN -COALESCE(tb.closing_balance,0)
            ELSE 0 END)::numeric, 0) AS net_using_type,
  ROUND(SUM(COALESCE(tb.debit_amount,0) - COALESCE(tb.credit_amount,0))::numeric, 0) AS net_debit_minus_credit
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
GROUP BY c.name
ORDER BY c.name;
