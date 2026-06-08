-- EXACT figure comparison: COA Mapping total vs Note total for every note, every client
-- Uses the SAME sign convention as nceAutoPopulate (note-nature signed)

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
-- Note nature lookup (CR-natural notes store Cr as positive)
note_nature AS (
  SELECT * FROM (VALUES
    ('borrowings','CR'),('other_lt_liab','CR'),('provisions','CR'),
    ('trade_payables','CR'),('other_cl','CR'),
    ('revenue_ops','CR'),('other_income','CR'),
    ('cwip','DR'),('investments','DR'),('loans_advances','DR'),
    ('other_nc_assets','DR'),('inventories','DR'),('trade_receivables','DR'),
    ('cash_bank','DR'),('other_ca','DR'),
    ('cogs','DR'),('employee_exp','DR'),('finance_costs','DR'),('other_expenses','DR')
  ) AS t(note_type, nature)
),
-- FS code to note type mapping
code_to_note AS (
  SELECT * FROM (VALUES
    ('NCE_LTB','borrowings'),('BS_NCL_LTB','borrowings'),
    ('NCE_STB','borrowings'),('BS_CL_STB','borrowings'),
    ('NCE_OLTL','other_lt_liab'),('BS_NCL_OLT','other_lt_liab'),('BS_NCL_DTL','other_lt_liab'),
    ('NCE_LTP','provisions'),('BS_NCL_LTP','provisions'),
    ('NCE_STP','provisions'),('BS_CL_STP','provisions'),
    ('NCE_TP','trade_payables'),('BS_CL_TP','trade_payables'),('BS_CL_TP_MSME','trade_payables'),('BS_CL_TP_OTH','trade_payables'),
    ('NCE_OCL','other_cl'),('BS_CL_OCL','other_cl'),
    ('NCE_CWIP','cwip'),('BS_NCA_FA_WIP','cwip'),
    ('NCE_NCINV','investments'),('BS_NCA_INV','investments'),
    ('NCE_CINV','investments'),('BS_CA_CI','investments'),
    ('NCE_LTLA','loans_advances'),('BS_NCA_LLA','loans_advances'),
    ('NCE_STLA','loans_advances'),('BS_CA_SLA','loans_advances'),
    ('NCE_ONCA','other_nc_assets'),('BS_NCA_ONA','other_nc_assets'),('BS_NCA_DTA','other_nc_assets'),
    ('NCE_STCK','inventories'),('BS_CA_INV','inventories'),
    ('INV_RM','inventories'),('INV_WIP','inventories'),('INV_FG','inventories'),('INV_STT','inventories'),('INV_STOCK','inventories'),
    ('NCE_TR','trade_receivables'),('BS_CA_TR','trade_receivables'),
    ('NCE_CASH','cash_bank'),('BS_CA_CCE','cash_bank'),
    ('NCE_OCA','other_ca'),('BS_CA_OCA','other_ca'),
    ('NCE_REV_OPS','revenue_ops'),('PL_REV_OPS','revenue_ops'),
    ('NCE_REV_OTH','other_income'),('PL_REV_OI','other_income'),
    ('NCE_COGS','cogs'),('NCE_CII','cogs'),('PL_EXP_MAT','cogs'),('PL_EXP_SIT','cogs'),('PL_EXP_CII','cogs'),
    ('NCE_EMP_EXP','employee_exp'),('PL_EXP_EMP','employee_exp'),
    ('NCE_FIN_COST','finance_costs'),('PL_EXP_FIN','finance_costs'),
    ('NCE_OTH_EXP','other_expenses'),('PL_EXP_OTH','other_expenses'),('PL_EXP_OEX','other_expenses')
  ) AS t(fs_code, note_type)
),
-- COA total per note type per client (note-nature signed: Cr positive for CR notes)
coa_per_note AS (
  SELECT
    ne.eid, ne.client, cn.note_type,
    nn.nature,
    ROUND(SUM(
      CASE
        WHEN nn.nature = 'CR' THEN
          CASE WHEN UPPER(COALESCE(tb.balance_type,''))='CR'
            THEN ABS(COALESCE(tb.closing_balance,0))
            ELSE -ABS(COALESCE(tb.closing_balance,0))
          END
        ELSE
          CASE WHEN UPPER(COALESCE(tb.balance_type,''))='DR'
            THEN ABS(COALESCE(tb.closing_balance,0))
            ELSE -ABS(COALESCE(tb.closing_balance,0))
          END
      END
    )::numeric, 0) AS coa_total_cy
  FROM nce_eng ne
  CROSS JOIN LATERAL jsonb_each(ne.coa_mapping) AS m(ledger_name, value)
  JOIN tally_trial_balance tb ON tb.engagement_id = ne.eid AND tb.ledger_name = m.ledger_name
  JOIN code_to_note cn ON cn.fs_code = m.value->>'code'
  JOIN note_nature nn ON nn.note_type = cn.note_type
  WHERE m.value->>'code' IS NOT NULL
  GROUP BY ne.eid, ne.client, cn.note_type, nn.nature
),
-- Note grand total from nce_financial_notes
-- Sum ALL numeric keys (excluding meta keys) as the note total
note_totals AS (
  SELECT
    ne.eid, ne.client, nfn.note_type,
    ROUND((SELECT COALESCE(SUM(v::numeric), 0) FROM jsonb_each_text(nfn.cy_data) kv(k,v)
     WHERE k NOT LIKE '\_%' AND k != 'total'
     AND v ~ '^-?[0-9]+\.?[0-9]*$')::numeric, 0) AS note_sum_cy
  FROM nce_eng ne
  JOIN nce_financial_notes nfn ON nfn.engagement_id = ne.eid AND nfn.financial_year = ne.fy
)
SELECT
  cp.client,
  cp.note_type,
  cp.nature,
  cp.coa_total_cy AS "COA Total",
  COALESCE(nt.note_sum_cy, 0) AS "Note Total",
  cp.coa_total_cy - COALESCE(nt.note_sum_cy, 0) AS "Difference",
  CASE
    WHEN nt.note_sum_cy IS NULL THEN 'NO NOTE'
    WHEN ABS(cp.coa_total_cy - nt.note_sum_cy) < 2 THEN 'MATCH'
    ELSE 'MISMATCH'
  END AS "Status"
FROM coa_per_note cp
LEFT JOIN note_totals nt ON nt.eid = cp.eid AND nt.note_type = cp.note_type
WHERE ABS(cp.coa_total_cy) > 1
ORDER BY cp.client,
  CASE cp.nature WHEN 'CR' THEN 0 ELSE 1 END,
  cp.note_type;
