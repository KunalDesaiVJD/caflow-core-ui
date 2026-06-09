SELECT
  m.value->>'code' AS fs_code,
  ROUND(SUM(CASE WHEN UPPER(tb.balance_type)='DR' THEN ABS(tb.closing_balance) ELSE -ABS(tb.closing_balance) END)::numeric, 0) AS amount
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
CROSS JOIN LATERAL jsonb_each(e.coa_mapping) AS m(ledger_name, value)
JOIN tally_trial_balance tb ON tb.engagement_id = e.id AND tb.ledger_name = m.ledger_name
WHERE c.name ILIKE '%Shivashray%' AND e.financial_year = '2025-26' AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
AND m.value->>'code' IN ('NCE_COGS','NCE_CII','NCE_EMP_EXP','NCE_FIN_COST','NCE_DEPR','NCE_OTH_EXP','NCE_REV_OPS','NCE_REV_OTH','NCE_STCK')
GROUP BY m.value->>'code' ORDER BY m.value->>'code';
