-- Diagnostic 4: Check if Profit & Loss A/c ledger is causing the TB imbalance
-- Tally creates a "Profit & Loss A/c" ledger that carries the current year's
-- net profit/loss. If this ledger is mapped to BS_EQ_RS but the code uses
-- OPENING balance instead of CLOSING, the P&L net is excluded from the
-- mapped amounts, creating an imbalance equal to the current year profit.

WITH nce_eng AS (
  SELECT e.id AS eid, c.name AS client, e.coa_mapping
  FROM audit_engagements e
  JOIN clients c ON c.id = e.client_id
  WHERE c.name ILIKE ANY(ARRAY[
    '%DBS Realty%','%Shree Hari Infra%','%Bhakti Infra%','%Maharsh Infra%',
    '%Shree Maruti Infra%','%Revti Infra%','%Shivashray%','%Salient Infratech%',
    '%Bapasitaram%','%Dhanani Realty%','%Shri Ram Products%'
  ])
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
)
SELECT
  ne.client,
  tb.ledger_name,
  ne.coa_mapping->tb.ledger_name->>'code' AS mapped_code,
  tb.closing_balance,
  tb.balance_type,
  tb.opening_balance,
  tb.opening_type,
  tb.debit_amount,
  tb.credit_amount,
  CASE WHEN tb.balance_type = 'Dr' THEN tb.closing_balance ELSE -tb.closing_balance END AS signed_closing,
  CASE WHEN tb.opening_type = 'Dr' THEN tb.opening_balance ELSE -tb.opening_balance END AS signed_opening,
  tb.parent_group
FROM nce_eng ne
JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid
WHERE (
  LOWER(tb.ledger_name) LIKE '%profit%loss%'
  OR LOWER(tb.ledger_name) LIKE '%p&l%'
  OR LOWER(tb.ledger_name) LIKE '%p & l%'
  OR ne.coa_mapping->tb.ledger_name->>'code' = 'BS_EQ_RS'
  OR ne.coa_mapping->tb.ledger_name->>'code' = 'NCE_CAP'
)
ORDER BY ne.client, tb.ledger_name;
