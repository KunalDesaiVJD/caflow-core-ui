-- Diagnostic 2: Per-client BS balance check from raw TB
-- Shows: mapped vs unmapped amounts, TB balance, and note vs face differences

WITH nce_eng AS (
  SELECT e.id AS eid, c.name AS client, e.financial_year AS fy, e.coa_mapping
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
tb_summary AS (
  SELECT
    ne.eid,
    ne.client,
    -- Total TB (should be 0 if balanced)
    SUM(CASE WHEN tb.balance_type='Dr' THEN COALESCE(tb.closing_balance,0) ELSE -COALESCE(tb.closing_balance,0) END) AS tb_net_cy,
    SUM(CASE WHEN tb.opening_type='Dr' THEN COALESCE(tb.opening_balance,0) ELSE -COALESCE(tb.opening_balance,0) END) AS tb_net_py,
    -- Mapped amounts (net of all mapped ledgers)
    SUM(CASE
      WHEN ne.coa_mapping->tb.ledger_name IS NOT NULL AND (ne.coa_mapping->tb.ledger_name->>'code') IS NOT NULL AND (ne.coa_mapping->tb.ledger_name->>'code') != ''
      THEN CASE WHEN tb.balance_type='Dr' THEN COALESCE(tb.closing_balance,0) ELSE -COALESCE(tb.closing_balance,0) END
      ELSE 0
    END) AS mapped_net_cy,
    SUM(CASE
      WHEN ne.coa_mapping->tb.ledger_name IS NOT NULL AND (ne.coa_mapping->tb.ledger_name->>'code') IS NOT NULL AND (ne.coa_mapping->tb.ledger_name->>'code') != ''
      THEN CASE WHEN tb.opening_type='Dr' THEN COALESCE(tb.opening_balance,0) ELSE -COALESCE(tb.opening_balance,0) END
      ELSE 0
    END) AS mapped_net_py,
    -- Unmapped amounts (net of all UNmapped ledgers)
    SUM(CASE
      WHEN ne.coa_mapping->tb.ledger_name IS NULL OR (ne.coa_mapping->tb.ledger_name->>'code') IS NULL OR (ne.coa_mapping->tb.ledger_name->>'code') = ''
      THEN CASE WHEN tb.balance_type='Dr' THEN COALESCE(tb.closing_balance,0) ELSE -COALESCE(tb.closing_balance,0) END
      ELSE 0
    END) AS unmapped_net_cy,
    SUM(CASE
      WHEN ne.coa_mapping->tb.ledger_name IS NULL OR (ne.coa_mapping->tb.ledger_name->>'code') IS NULL OR (ne.coa_mapping->tb.ledger_name->>'code') = ''
      THEN CASE WHEN tb.opening_type='Dr' THEN COALESCE(tb.opening_balance,0) ELSE -COALESCE(tb.opening_balance,0) END
      ELSE 0
    END) AS unmapped_net_py,
    -- Count unmapped
    COUNT(*) FILTER (WHERE ne.coa_mapping->tb.ledger_name IS NULL OR (ne.coa_mapping->tb.ledger_name->>'code') IS NULL OR (ne.coa_mapping->tb.ledger_name->>'code') = '') AS unmapped_count
  FROM nce_eng ne
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid
  GROUP BY ne.eid, ne.client
)
SELECT
  client,
  unmapped_count,
  ROUND(tb_net_cy::numeric, 0) AS tb_net_cy,
  ROUND(tb_net_py::numeric, 0) AS tb_net_py,
  ROUND(mapped_net_cy::numeric, 0) AS mapped_net_cy,
  ROUND(mapped_net_py::numeric, 0) AS mapped_net_py,
  ROUND(unmapped_net_cy::numeric, 0) AS unmapped_net_cy,
  ROUND(unmapped_net_py::numeric, 0) AS unmapped_net_py
FROM tb_summary
ORDER BY client;
