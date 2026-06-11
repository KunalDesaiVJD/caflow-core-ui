-- NCE Notes vs COA universal reconciliation fix.
-- For every drift cell (Note Total != COA Total) in scope notes, add a
-- balancing customRow "coa_reconcile_balance" so Note Total = COA Total.
--
-- Scope: ALL Pattern B notes including BS and PL lines, EXCEPT:
--   - cogs (changes-in-inventories math; mapping ≠ note structure by design)
--   - inventories (manually-entered closing stock often exceeds TB mappings)
--   - capital account / fixed assets (user-excluded)
--
-- Idempotent: re-running over an already-fixed row will simply overwrite the
-- existing coa_reconcile_balance amount to the latest drift.

-- ── 1. drift detection (same logic as nce_drift_sweep.sql) ────────────────
WITH code_map(code, note_type, nature) AS (
  VALUES
    ('NCE_LTB','borrowings','CR'),
    ('NCE_STB','borrowings','CR'),
    ('NCE_OLTL','other_lt_liab','CR'),
    ('NCE_LTP','provisions','CR'),
    ('NCE_STP','provisions','CR'),
    ('NCE_TP','trade_payables','CR'),
    ('NCE_OCL','other_cl','CR'),
    ('NCE_CWIP','cwip','DR'),
    ('NCE_NCINV','investments','DR'),
    ('NCE_CINV','investments','DR'),
    ('NCE_LTLA','loans_advances','DR'),
    ('NCE_STLA','loans_advances','DR'),
    ('NCE_ONCA','other_nc_assets','DR'),
    ('NCE_TR','trade_receivables','DR'),
    ('NCE_CASH','cash_bank','DR'),
    ('NCE_OCA','other_ca','DR'),
    ('NCE_REV_OPS','revenue_ops','CR'),
    ('NCE_REV_OTH','other_income','CR'),
    ('NCE_EMP_EXP','employee_exp','DR'),
    ('NCE_FIN_COST','finance_costs','DR'),
    ('NCE_OTH_EXP','other_expenses','DR')
),
nce_clients AS (
  SELECT id FROM clients WHERE entity_type IN
    ('Partnership','Individual','HUF','AOP','Trust','LLP','Proprietorship')
),
cy_eng AS (
  SELECT ae.id, ae.client_id, ae.financial_year, ae.coa_mapping
  FROM audit_engagements ae JOIN nce_clients c ON c.id=ae.client_id
  WHERE ae.financial_year='2025-26'
),
py_eng AS (
  SELECT ae.id as py_id, ae.client_id
  FROM audit_engagements ae JOIN nce_clients c ON c.id=ae.client_id
  WHERE ae.financial_year='2024-25'
),
coa_per_eng AS (
  SELECT ce.id as engagement_id, lname as ledger_name, (info->>'code') as code
  FROM cy_eng ce, jsonb_each(ce.coa_mapping) m(lname, info)
  WHERE info->>'code' IS NOT NULL
),
joined AS (
  SELECT
    cpe.engagement_id, cm.note_type, cm.nature, cpe.ledger_name,
    tc.closing_balance::numeric as cy_amt, tc.closing_type as cy_type,
    tp.closing_balance::numeric as py_amt, tp.closing_type as py_type
  FROM coa_per_eng cpe
  JOIN code_map cm ON cm.code = cpe.code
  JOIN cy_eng ce ON ce.id = cpe.engagement_id
  LEFT JOIN py_eng pe ON pe.client_id = ce.client_id
  LEFT JOIN tally_ledgers tc ON tc.engagement_id = cpe.engagement_id
       AND lower(tc.ledger_name) = lower(cpe.ledger_name)
  LEFT JOIN tally_ledgers tp ON tp.engagement_id = pe.py_id
       AND lower(tp.ledger_name) = lower(cpe.ledger_name)
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
-- subtract any existing balance row from "current note total" so we don't
-- double-count when reconciling a previously-fixed cell
existing_balance AS (
  SELECT n.engagement_id, n.note_type,
    coalesce((n.cy_data->>'coa_reconcile_balance')::numeric, 0) as bal_cy,
    coalesce((n.py_data->>'coa_reconcile_balance')::numeric, 0) as bal_py
  FROM nce_financial_notes n
),
note_totals AS (
  SELECT
    n.engagement_id, n.note_type, n.cy_data, n.py_data,
    round((coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.cy_data) x(k,v)
                     WHERE substring(k,1,1) != '_' AND k != 'coa_reconcile_balance'
                       AND v ~ '^-?[0-9]'),0))::numeric, 2) as note_cy_base,
    round((coalesce((SELECT sum((v)::numeric) FROM jsonb_each_text(n.py_data) x(k,v)
                     WHERE substring(k,1,1) != '_' AND k != 'coa_reconcile_balance'
                       AND v ~ '^-?[0-9]'),0))::numeric, 2) as note_py_base
  FROM nce_financial_notes n
  WHERE n.engagement_id IN (SELECT id FROM cy_eng)
),
fix_cells AS (
  SELECT
    ct.engagement_id,
    (SELECT financial_year FROM cy_eng ce WHERE ce.id = ct.engagement_id) as fy,
    ct.note_type,
    ct.coa_cy, coalesce(nt.note_cy_base, 0) as note_cy_base,
    round((ct.coa_cy - coalesce(nt.note_cy_base, 0))::numeric, 2) as need_cy,
    ct.coa_py, coalesce(nt.note_py_base, 0) as note_py_base,
    round((ct.coa_py - coalesce(nt.note_py_base, 0))::numeric, 2) as need_py
  FROM coa_totals ct
  LEFT JOIN note_totals nt ON nt.engagement_id=ct.engagement_id AND nt.note_type=ct.note_type
  WHERE abs(ct.coa_cy - coalesce(nt.note_cy_base, 0)) > 1
     OR abs(ct.coa_py - coalesce(nt.note_py_base, 0)) > 1
),
-- ── 2. update existing rows: append/refresh balance customRow ────────────
updated AS (
  UPDATE nce_financial_notes n SET
    cy_data = (
      -- strip prior balance row from _custom_rows, then append the fresh one
      jsonb_set(
        jsonb_set(
          coalesce(n.cy_data, '{}'::jsonb),
          ARRAY['_custom_rows'],
          (
            SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'id','coa_reconcile_balance',
                'label','COA Reconciliation Adjustment',
                'source','manual'
              )
            )
            FROM jsonb_array_elements(coalesce(n.cy_data->'_custom_rows','[]'::jsonb)) elem
            WHERE elem->>'id' != 'coa_reconcile_balance'
          )
        ),
        ARRAY['coa_reconcile_balance'],
        to_jsonb(f.need_cy)
      )
    ),
    py_data = jsonb_set(
      coalesce(n.py_data, '{}'::jsonb),
      ARRAY['coa_reconcile_balance'],
      to_jsonb(f.need_py)
    ),
    updated_at = now()
  FROM fix_cells f
  WHERE n.engagement_id = f.engagement_id AND n.note_type = f.note_type
  RETURNING n.engagement_id, n.note_type
),
-- ── 3. insert new rows for engagement+note_type pairs that don't yet exist
inserted AS (
  INSERT INTO nce_financial_notes (engagement_id, financial_year, note_type, cy_data, py_data, created_at, updated_at)
  SELECT
    f.engagement_id, f.fy, f.note_type,
    jsonb_build_object(
      '_custom_rows', jsonb_build_array(jsonb_build_object(
        'id','coa_reconcile_balance',
        'label','COA Reconciliation Adjustment',
        'source','manual'
      )),
      'coa_reconcile_balance', f.need_cy
    ),
    jsonb_build_object('coa_reconcile_balance', f.need_py),
    now(), now()
  FROM fix_cells f
  WHERE NOT EXISTS (
    SELECT 1 FROM nce_financial_notes nf
    WHERE nf.engagement_id = f.engagement_id AND nf.note_type = f.note_type
  )
  RETURNING engagement_id, note_type
)
SELECT
  (SELECT count(*) FROM updated)  as rows_updated,
  (SELECT count(*) FROM inserted) as rows_inserted,
  (SELECT count(*) FROM fix_cells) as total_drift_cells
