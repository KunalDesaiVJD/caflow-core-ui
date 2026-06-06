-- FS Diagnostic: Compare COA Mapping totals vs Note totals for all NCE clients
-- Run with: npx supabase db query --linked "$(cat scripts/fs-diagnostic.sql)"

-- Step 1: Get all NCE engagements for the 10 named clients
WITH nce_engagements AS (
  SELECT
    e.id AS engagement_id,
    c.name AS client_name,
    e.financial_year,
    e.coa_mapping
  FROM audit_engagements e
  JOIN clients c ON c.id = e.client_id
  WHERE c.name ILIKE ANY(ARRAY[
    '%DBS Realty%', '%Shree Hari Infra%', '%Bhakti Infra%',
    '%Maharsh Infra%', '%Shree Maruti Infra%', '%Revti Infra%',
    '%Shivashray%', '%Salient Infratech%', '%Bapasitaram%',
    '%Dhanani Realty%', '%Shri Ram Products%'
  ])
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
),

-- Step 2: For each engagement, compute COA mapping totals per FS code
coa_totals AS (
  SELECT
    ne.engagement_id,
    ne.client_name,
    m.value->>'code' AS fs_code,
    SUM(
      CASE
        WHEN tb.balance_type = 'Dr' THEN COALESCE(tb.closing_balance, 0)
        ELSE -COALESCE(tb.closing_balance, 0)
      END
    ) AS coa_cy,
    SUM(
      CASE
        WHEN tb.opening_type = 'Dr' THEN COALESCE(tb.opening_balance, 0)
        ELSE -COALESCE(tb.opening_balance, 0)
      END
    ) AS coa_py
  FROM nce_engagements ne
  CROSS JOIN LATERAL jsonb_each(ne.coa_mapping) AS m(ledger_name, value)
  JOIN tally_trial_balance tb
    ON tb.engagement_id = ne.engagement_id
    AND tb.ledger_name = m.ledger_name
  WHERE m.value->>'code' IS NOT NULL
  GROUP BY ne.engagement_id, ne.client_name, m.value->>'code'
),

-- Step 3: Get note totals from nce_financial_notes
note_data AS (
  SELECT
    ne.engagement_id,
    ne.client_name,
    nfn.note_type,
    nfn.cy_data,
    nfn.py_data
  FROM nce_engagements ne
  JOIN nce_financial_notes nfn
    ON nfn.engagement_id = ne.engagement_id
    AND nfn.financial_year = ne.financial_year
),

-- Step 4: Count unmapped TB ledgers (ledgers with no COA code)
unmapped AS (
  SELECT
    ne.engagement_id,
    ne.client_name,
    COUNT(*) AS unmapped_count,
    SUM(COALESCE(tb.closing_balance, 0)) AS unmapped_amount
  FROM nce_engagements ne
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.engagement_id
  LEFT JOIN LATERAL (
    SELECT ne.coa_mapping->tb.ledger_name AS mapping
  ) cm ON true
  WHERE cm.mapping IS NULL OR cm.mapping->>'code' IS NULL OR cm.mapping->>'code' = ''
  GROUP BY ne.engagement_id, ne.client_name
),

-- Step 5: Find codes that have COA amounts but NO note mapping
orphan_codes AS (
  SELECT
    ct.engagement_id,
    ct.client_name,
    ct.fs_code,
    ct.coa_cy,
    ct.coa_py,
    CASE
      WHEN ct.fs_code IN ('NCE_CAP','NCE_PPE','NCE_INTG','NCE_DEPR','NCE_COGS','NCE_CII',
                          'NCE_PART_REM','NCE_CUR_TAX','NCE_PRIOR_TAX','NCE_DEFER_TAX',
                          'BS_EQ_RS','BS_EQ_SC','BS_NCA_FA_TAN','PL_EXP_DEP','PL_TAX_CUR','PL_TAX_DEF',
                          'NCE_RES','NCE_PCAP','NCE_NCB','NCE_EXCEP','NCE_EXTORD')
      THEN 'No note (intentional — single-line item or special component)'
      WHEN ct.fs_code NOT IN (
        'NCE_LTB','BS_NCL_LTB','NCE_STB','BS_CL_STB',
        'NCE_OLTL','BS_NCL_OLT','BS_NCL_DTL',
        'NCE_LTP','BS_NCL_LTP','NCE_STP','BS_CL_STP',
        'NCE_TP','BS_CL_TP','BS_CL_TP_MSME','BS_CL_TP_OTH',
        'NCE_OCL','BS_CL_OCL',
        'NCE_CWIP','BS_NCA_FA_WIP',
        'NCE_NCINV','BS_NCA_INV','NCE_CINV','BS_CA_CI',
        'NCE_LTLA','BS_NCA_LLA','NCE_STLA','BS_CA_SLA',
        'NCE_ONCA','BS_NCA_ONA','BS_NCA_DTA',
        'NCE_STCK','BS_CA_INV','INV_RM','INV_WIP','INV_FG','INV_STT','INV_STOCK',
        'NCE_TR','BS_CA_TR',
        'NCE_CASH','BS_CA_CCE',
        'NCE_OCA','BS_CA_OCA',
        'NCE_REV_OPS','PL_REV_OPS',
        'NCE_REV_OTH','PL_REV_OI',
        'NCE_COGS','NCE_CII','PL_EXP_MAT','PL_EXP_SIT','PL_EXP_CII',
        'NCE_EMP_EXP','PL_EXP_EMP',
        'NCE_FIN_COST','PL_EXP_FIN',
        'NCE_OTH_EXP','PL_EXP_OTH','PL_EXP_OEX'
      )
      THEN 'CODE NOT IN NCE_NOTE_FS_MAP — ledgers SILENTLY DROPPED from notes'
      ELSE 'Covered by note mapping'
    END AS status
  FROM coa_totals ct
  WHERE ABS(ct.coa_cy) > 0.01 OR ABS(ct.coa_py) > 0.01
)

-- Final output: per-client summary of all codes with amounts
SELECT
  oc.client_name,
  oc.fs_code,
  ROUND(oc.coa_cy::numeric, 0) AS coa_cy,
  ROUND(oc.coa_py::numeric, 0) AS coa_py,
  oc.status,
  COALESCE(um.unmapped_count, 0) AS unmapped_ledgers
FROM orphan_codes oc
LEFT JOIN unmapped um ON um.engagement_id = oc.engagement_id
WHERE oc.status != 'Covered by note mapping'
ORDER BY oc.client_name, ABS(oc.coa_cy) DESC;
