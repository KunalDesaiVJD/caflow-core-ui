-- Per-year (CY and PY separately) full-book NCE assurance — one row per
-- FY 2025-26 NCE engagement. Includes:
--   • drift_cy / drift_py — count of in-scope (engagement, note) cells where
--     Note Total ≠ COA Total (legacy codes folded), tolerance ₹1
--   • cogs_identity_gaps — count of inventory categories where the note's
--     PY closing ≠ CY opening (the OM REALTY Note 14 class)
--   • bare_key_pattern_a — count of renderer-invisible bare keys remaining
--     on Pattern A notes (the BHAKTI class; must stay 0)
-- Only Capital Account & Fixed Assets remain exempt.
WITH code_map(code, note_type, nature) AS (
  VALUES
    ('NCE_LTB','borrowings','CR'), ('NCE_STB','borrowings','CR'),
    ('NCE_OLTL','other_lt_liab','CR'),
    ('NCE_LTP','provisions','CR'), ('NCE_STP','provisions','CR'),
    ('NCE_TP','trade_payables','CR'), ('NCE_OCL','other_cl','CR'),
    ('NCE_CWIP','cwip','DR'),
    ('NCE_NCINV','investments','DR'), ('NCE_CINV','investments','DR'),
    ('NCE_LTLA','loans_advances','DR'), ('NCE_STLA','loans_advances','DR'),
    ('NCE_ONCA','other_nc_assets','DR'),
    ('NCE_TR','trade_receivables','DR'), ('NCE_CASH','cash_bank','DR'),
    ('NCE_OCA','other_ca','DR'),
    ('NCE_REV_OPS','revenue_ops','CR'), ('NCE_REV_OTH','other_income','CR'),
    ('NCE_EMP_EXP','employee_exp','DR'), ('NCE_FIN_COST','finance_costs','DR'),
    ('NCE_OTH_EXP','other_expenses','DR'),
    ('BS_NCL_LTB','borrowings','CR'), ('BS_CL_STB','borrowings','CR'),
    ('BS_NCL_OLT','other_lt_liab','CR'), ('BS_NCL_DTL','other_lt_liab','CR'),
    ('BS_NCL_LTP','provisions','CR'), ('BS_CL_STP','provisions','CR'),
    ('BS_CL_TP','trade_payables','CR'), ('BS_CL_TP_MSME','trade_payables','CR'),
    ('BS_CL_TP_OTH','trade_payables','CR'),
    ('BS_CL_OCL','other_cl','CR'),
    ('BS_NCA_FA_WIP','cwip','DR'),
    ('BS_NCA_INV','investments','DR'), ('BS_CA_CI','investments','DR'),
    ('BS_NCA_LLA','loans_advances','DR'), ('BS_CA_SLA','loans_advances','DR'),
    ('BS_NCA_ONA','other_nc_assets','DR'), ('BS_NCA_DTA','other_nc_assets','DR'),
    ('BS_CA_TR','trade_receivables','DR'), ('BS_CA_CCE','cash_bank','DR'),
    ('BS_CA_OCA','other_ca','DR'),
    ('PL_REV_OPS','revenue_ops','CR'), ('PL_REV_OI','other_income','CR'),
    ('PL_EXP_EMP','employee_exp','DR'), ('PL_EXP_FIN','finance_costs','DR'),
    ('PL_EXP_OTH','other_expenses','DR'), ('PL_EXP_OEX','other_expenses','DR')
),
nce_clients AS (
  SELECT id, name FROM clients WHERE entity_type IN
    ('Partnership','Individual','HUF','AOP','Trust','LLP','Proprietorship')
),
cy_eng AS (
  SELECT ae.id, ae.client_id, ae.coa_mapping, c.name
  FROM audit_engagements ae JOIN nce_clients c ON c.id=ae.client_id
  WHERE ae.financial_year='2025-26'
),
py_eng AS (
  SELECT ae.id as py_id, ae.client_id
  FROM audit_engagements ae JOIN nce_clients c ON c.id=ae.client_id
  WHERE ae.financial_year='2024-25'
),
coa_per_eng AS (
  -- RC-12: dedupe by case-insensitive name — duplicate mapping keys (same
  -- ledger, different case) must count the physical TB ledger ONCE, matching
  -- the app (which iterates TB rows, not mapping keys).
  SELECT DISTINCT ON (ce.id, lower(trim(lname)))
         ce.id as engagement_id, lname as ledger_name, (info->>'code') as code
  FROM cy_eng ce, jsonb_each(ce.coa_mapping) m(lname, info)
  WHERE info->>'code' IS NOT NULL
  ORDER BY ce.id, lower(trim(lname)),
    -- the app looks up coaMapping[tb.ledger_name] EXACTLY: the variant whose
    -- key equals the physical TB name is the live one; others are dead keys
    (EXISTS (SELECT 1 FROM tally_ledgers t WHERE t.engagement_id=ce.id AND t.ledger_name = lname)) DESC,
    (EXISTS (SELECT 1 FROM py_eng pe2 JOIN tally_ledgers t2 ON t2.engagement_id=pe2.py_id
             WHERE pe2.client_id=ce.client_id AND t2.ledger_name = lname)) DESC,
    lname
),
joined AS (
  -- PY source: PY-shell TB closing when the client has a 2024-25 engagement;
  -- otherwise the CY TB OPENING balance (the app's computeCOATotals fallback).
  SELECT cpe.engagement_id, cm.note_type, cm.nature,
    tc.closing_balance::numeric as cy_amt, tc.closing_type as cy_type,
    CASE WHEN pe.py_id IS NOT NULL THEN tp.closing_balance::numeric
         ELSE tc.opening_balance::numeric END as py_amt,
    CASE WHEN pe.py_id IS NOT NULL THEN tp.closing_type
         ELSE tc.opening_type END as py_type
  FROM coa_per_eng cpe
  JOIN code_map cm ON cm.code = cpe.code
  JOIN cy_eng ce ON ce.id = cpe.engagement_id
  LEFT JOIN py_eng pe ON pe.client_id = ce.client_id
  LEFT JOIN tally_ledgers tc ON tc.engagement_id = cpe.engagement_id
       AND lower(trim(tc.ledger_name)) = lower(trim(cpe.ledger_name))
  LEFT JOIN tally_ledgers tp ON tp.engagement_id = pe.py_id
       AND lower(trim(tp.ledger_name)) = lower(trim(cpe.ledger_name))
),
coa_totals AS (
  SELECT engagement_id, note_type,
    round(sum(CASE WHEN cy_amt IS NULL THEN 0
                   WHEN upper(coalesce(cy_type,'')) = nature THEN abs(cy_amt)
                   WHEN upper(coalesce(cy_type,'')) = '' THEN CASE WHEN nature='CR' THEN abs(cy_amt) ELSE -abs(cy_amt) END
                   ELSE -abs(cy_amt) END)::numeric, 2) as coa_cy,
    round(sum(CASE WHEN py_amt IS NULL THEN 0
                   WHEN upper(coalesce(py_type,'')) = nature THEN abs(py_amt)
                   WHEN upper(coalesce(py_type,'')) = '' THEN CASE WHEN nature='CR' THEN abs(py_amt) ELSE -abs(py_amt) END
                   ELSE -abs(py_amt) END)::numeric, 2) as coa_py
  FROM joined GROUP BY engagement_id, note_type
),
note_totals AS (
  SELECT n.engagement_id, n.note_type,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.cy_data) x(k,v)
                    WHERE substring(k,1,1) != '_' AND v ~ '^-?[0-9]'),0)::numeric, 2) as note_cy,
    round(coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.py_data) x(k,v)
                    WHERE substring(k,1,1) != '_' AND v ~ '^-?[0-9]'),0)::numeric, 2) as note_py
  FROM nce_financial_notes n
  WHERE n.engagement_id IN (SELECT id FROM cy_eng)
),
cells AS (
  SELECT ct.engagement_id, ct.note_type,
    abs(ct.coa_cy - coalesce(nt.note_cy,0)) as dcy,
    abs(ct.coa_py - coalesce(nt.note_py,0)) as dpy
  FROM coa_totals ct
  LEFT JOIN note_totals nt ON nt.engagement_id=ct.engagement_id AND nt.note_type=ct.note_type
),
cogs_pairs(open_k, close_k) AS (
  VALUES ('pc_open_trade','pc_close_trade'),('pc_open_wip','pc_close_wip'),
         ('pc_open_fg','pc_close_fg'),('raw_open','raw_close'),
         ('pack_open','pack_close'),('other_open','other_close')
),
cogs_gaps AS (
  SELECT n.engagement_id, count(*) as gaps
  FROM nce_financial_notes n CROSS JOIN cogs_pairs p
  WHERE n.note_type='cogs'
    AND n.engagement_id IN (SELECT id FROM cy_eng)
    AND abs(coalesce((n.cy_data->>p.open_k)::numeric,0) - coalesce((n.py_data->>p.close_k)::numeric,0)) > 1
  GROUP BY n.engagement_id
),
bare_a AS (
  SELECT n.engagement_id, count(*) as bare
  FROM nce_financial_notes n, jsonb_each(n.cy_data) x(k,v)
  WHERE n.note_type IN ('borrowings','provisions','loans_advances','investments')
    AND n.engagement_id IN (SELECT id FROM cy_eng)
    AND substring(k,1,1) != '_'
    AND k NOT LIKE '%!_lt' ESCAPE '!' AND k NOT LIKE '%!_st' ESCAPE '!'
    AND jsonb_typeof(v)='number' AND (v)::text::numeric != 0
    AND NOT (n.cy_data ? (k || '_lt')) AND NOT (n.cy_data ? (k || '_st'))
  GROUP BY n.engagement_id
)
SELECT
  ce.name as client,
  (SELECT count(*) FROM nce_financial_notes n WHERE n.engagement_id=ce.id) as notes,
  coalesce((SELECT count(*) FROM cells x WHERE x.engagement_id=ce.id AND x.dcy > 1), 0) as drift_cy,
  coalesce((SELECT count(*) FROM cells x WHERE x.engagement_id=ce.id AND x.dpy > 1), 0) as drift_py,
  coalesce((SELECT gaps FROM cogs_gaps g WHERE g.engagement_id=ce.id), 0) as cogs_identity_gaps,
  coalesce((SELECT bare FROM bare_a b WHERE b.engagement_id=ce.id), 0) as bare_key_pattern_a,
  CASE WHEN EXISTS (SELECT 1 FROM py_eng pe WHERE pe.client_id=ce.client_id) THEN 'Y' ELSE 'N' END as has_py
FROM cy_eng ce
ORDER BY ce.name
