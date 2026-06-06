-- Runtime diagnostic: Pick SHRI RAM PRODUCTS (worst drift with 196 unmapped)
-- Dump all TB ledgers with their COA mapping, signed values, and note assignment

WITH eng AS (
  SELECT e.id AS eid, c.name AS client, e.financial_year, e.coa_mapping
  FROM audit_engagements e
  JOIN clients c ON c.id = e.client_id
  WHERE c.name ILIKE '%Shri Ram Products%'
    AND e.financial_year = '2025-26'
    AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  LIMIT 1
),
-- 3A: Raw TB with COA mapping
tb_raw AS (
  SELECT
    eng.eid,
    eng.client,
    tb.ledger_name,
    tb.closing_balance,
    tb.balance_type,
    tb.opening_balance,
    tb.opening_type,
    tb.debit_amount,
    tb.credit_amount,
    tb.parent_group,
    eng.coa_mapping->tb.ledger_name->>'code' AS fs_code,
    -- Signed closing (debit-positive, same as tbAccounts in PipelineFS)
    CASE WHEN UPPER(COALESCE(tb.balance_type,'')) = 'DR'
      THEN ABS(COALESCE(tb.closing_balance,0))
      ELSE -ABS(COALESCE(tb.closing_balance,0))
    END AS signed_closing,
    -- Signed opening
    CASE WHEN UPPER(COALESCE(tb.opening_type,'')) = 'DR'
      THEN ABS(COALESCE(tb.opening_balance,0))
      ELSE -ABS(COALESCE(tb.opening_balance,0))
    END AS signed_opening
  FROM eng
  JOIN tally_trial_balance tb ON tb.engagement_id = eng.eid
),
-- 3B: COA totals per FS code
coa_by_code AS (
  SELECT
    fs_code,
    ROUND(SUM(signed_closing)::numeric, 2) AS coa_cy,
    ROUND(SUM(signed_opening)::numeric, 2) AS coa_py,
    COUNT(*) AS ledger_count
  FROM tb_raw
  WHERE fs_code IS NOT NULL AND fs_code != ''
  GROUP BY fs_code
),
-- Unmapped summary
unmapped_summary AS (
  SELECT
    COUNT(*) AS cnt,
    ROUND(SUM(signed_closing)::numeric, 2) AS net_cy,
    ROUND(SUM(signed_opening)::numeric, 2) AS net_py
  FROM tb_raw
  WHERE fs_code IS NULL OR fs_code = ''
),
-- 3C: Note data
notes AS (
  SELECT
    nfn.note_type,
    nfn.cy_data,
    nfn.py_data
  FROM eng
  JOIN nce_financial_notes nfn
    ON nfn.engagement_id = eng.eid
    AND nfn.financial_year = eng.financial_year
)
-- Output: COA totals per code + note type mapping
SELECT
  c.fs_code,
  c.coa_cy,
  c.coa_py,
  c.ledger_count,
  -- Determine which note type this code maps to
  CASE
    WHEN c.fs_code IN ('NCE_LTB','BS_NCL_LTB') THEN 'borrowings (LT)'
    WHEN c.fs_code IN ('NCE_STB','BS_CL_STB') THEN 'borrowings (ST)'
    WHEN c.fs_code IN ('NCE_OLTL','BS_NCL_OLT','BS_NCL_DTL') THEN 'other_lt_liab'
    WHEN c.fs_code IN ('NCE_LTP','BS_NCL_LTP') THEN 'provisions (LT)'
    WHEN c.fs_code IN ('NCE_STP','BS_CL_STP') THEN 'provisions (ST)'
    WHEN c.fs_code IN ('NCE_TP','BS_CL_TP','BS_CL_TP_MSME','BS_CL_TP_OTH') THEN 'trade_payables'
    WHEN c.fs_code IN ('NCE_OCL','BS_CL_OCL') THEN 'other_cl'
    WHEN c.fs_code IN ('NCE_CWIP','BS_NCA_FA_WIP') THEN 'cwip'
    WHEN c.fs_code IN ('NCE_NCINV','BS_NCA_INV') THEN 'investments (LT)'
    WHEN c.fs_code IN ('NCE_CINV','BS_CA_CI') THEN 'investments (ST)'
    WHEN c.fs_code IN ('NCE_LTLA','BS_NCA_LLA') THEN 'loans_advances (LT)'
    WHEN c.fs_code IN ('NCE_STLA','BS_CA_SLA') THEN 'loans_advances (ST)'
    WHEN c.fs_code IN ('NCE_ONCA','BS_NCA_ONA','BS_NCA_DTA') THEN 'other_nc_assets'
    WHEN c.fs_code IN ('NCE_STCK','BS_CA_INV','INV_RM','INV_WIP','INV_FG','INV_STT','INV_STOCK') THEN 'inventories'
    WHEN c.fs_code IN ('NCE_TR','BS_CA_TR') THEN 'trade_receivables'
    WHEN c.fs_code IN ('NCE_CASH','BS_CA_CCE') THEN 'cash_bank'
    WHEN c.fs_code IN ('NCE_OCA','BS_CA_OCA') THEN 'other_ca'
    WHEN c.fs_code IN ('NCE_REV_OPS','PL_REV_OPS') THEN 'revenue_ops'
    WHEN c.fs_code IN ('NCE_REV_OTH','PL_REV_OI') THEN 'other_income'
    WHEN c.fs_code IN ('NCE_COGS','NCE_CII','PL_EXP_MAT','PL_EXP_SIT','PL_EXP_CII') THEN 'cogs'
    WHEN c.fs_code IN ('NCE_EMP_EXP','PL_EXP_EMP') THEN 'employee_exp'
    WHEN c.fs_code IN ('NCE_FIN_COST','PL_EXP_FIN') THEN 'finance_costs'
    WHEN c.fs_code IN ('NCE_OTH_EXP','PL_EXP_OTH','PL_EXP_OEX') THEN 'other_expenses'
    WHEN c.fs_code IN ('NCE_CAP') THEN '(NO NOTE - Capital Account component)'
    WHEN c.fs_code IN ('NCE_PPE') THEN '(NO NOTE - FA Grid / PPE Schedule)'
    WHEN c.fs_code IN ('NCE_DEPR','PL_EXP_DEP') THEN '(NO NOTE - single P&L line)'
    WHEN c.fs_code IN ('NCE_PART_REM') THEN '(NO NOTE - single P&L line)'
    WHEN c.fs_code IN ('BS_EQ_RS') THEN '(SPECIAL - P&L A/c → fold into NCE_CAP)'
    ELSE '??? UNKNOWN - NOT IN ANY NOTE'
  END AS note_mapping
FROM coa_by_code c
ORDER BY
  CASE WHEN c.fs_code LIKE 'NCE_CAP%' OR c.fs_code = 'BS_EQ_RS' THEN 0
       WHEN c.fs_code LIKE 'NCE_L%' OR c.fs_code LIKE 'NCE_O%' AND c.fs_code LIKE '%TL%' THEN 1
       WHEN c.fs_code LIKE 'NCE_S%' OR c.fs_code LIKE 'NCE_T%' THEN 2
       WHEN c.fs_code LIKE 'NCE_P%' OR c.fs_code LIKE 'NCE_C%' THEN 3
       WHEN c.fs_code LIKE 'NCE_R%' THEN 4
       ELSE 5 END,
  c.fs_code;
