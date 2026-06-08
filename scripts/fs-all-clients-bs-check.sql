-- Replicate Stage 3 BS balance check for ALL 11 clients
-- Logic: sum all mapped ledgers (debit-positive), handle P&L A/c using opening,
-- auto-credit NCE_NET_PROF to NCE_CAP only when P&L A/c has non-zero closing

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
),
-- Compute BS totals per client
bs_check AS (
  SELECT
    ne.client,
    -- Asset total (debit-positive)
    ROUND(SUM(CASE
      WHEN ne.coa_mapping->tb.ledger_name->>'code' IN (
        'NCE_PPE','NCE_CWIP','NCE_INTG','NCE_NCINV','NCE_LTLA','NCE_ONCA',
        'NCE_CINV','NCE_STCK','NCE_TR','NCE_CASH','NCE_STLA','NCE_OCA'
      ) THEN CASE WHEN UPPER(tb.balance_type)='DR' THEN ABS(tb.closing_balance) ELSE -ABS(tb.closing_balance) END
      ELSE 0
    END)::numeric, 0) AS total_assets,
    -- Liability total (debit-positive, so these are negative)
    ROUND(SUM(CASE
      WHEN ne.coa_mapping->tb.ledger_name->>'code' IN (
        'NCE_CAP','NCE_LTB','NCE_STB','NCE_OLTL','NCE_LTP','NCE_STP','NCE_TP','NCE_OCL'
      ) THEN CASE WHEN UPPER(tb.balance_type)='DR' THEN ABS(tb.closing_balance) ELSE -ABS(tb.closing_balance) END
      ELSE 0
    END)::numeric, 0) AS total_el,
    -- P&L A/c closing (for the auto-credit check)
    MAX(CASE
      WHEN ne.coa_mapping->tb.ledger_name->>'code' = 'BS_EQ_RS'
        AND LOWER(tb.ledger_name) LIKE '%profit%loss%'
      THEN ABS(tb.closing_balance)
      ELSE 0
    END) AS plac_closing
  FROM nce_eng ne
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid
  GROUP BY ne.client
)
SELECT
  client,
  total_assets AS "Assets (Dr+)",
  total_el AS "E&L (Cr-)",
  total_assets + total_el AS "Raw Diff",
  plac_closing AS "P&L A/c Close",
  CASE WHEN plac_closing > 1 THEN 'needs auto-credit' ELSE 'no credit (profit in capital)' END AS "Credit Status",
  CASE WHEN ABS(total_assets + total_el) < 2 THEN 'BALANCED' ELSE 'check needed' END AS "BS Status"
FROM bs_check
ORDER BY client;
