-- Per-ledger reconstruction — replaces every coa_reconcile_balance plug with
-- the REAL ledger-level figures from TB × COA mapping.
--
-- For each note carrying a plug:
--   FWD pass: for every mapped ledger, delta = signedTB − (label-matched row
--             value + _cy_sources attribution). Apply delta to the real row,
--             or create a real per-ledger row when none exists.
--   ASSERTION: Σ(deltas) must equal the plug value within ₹1 for BOTH years —
--             otherwise the note is SKIPPED and reported (never made worse).
--   Finally: plug keys + plug customRow entry removed.
--
-- Data-only. Idempotent: after a successful run the plug is gone, so the
-- note no longer matches the selection filter.
DO $$
DECLARE
  r record; l record;
  v_cy jsonb; v_py jsonb;
  v_plug_cy numeric; v_plug_py numeric;
  v_sum_dcy numeric; v_sum_dpy numeric;
  v_pattern_a boolean;
  v_py_eng uuid;
  v_key text; v_cur numeric; v_slug text; v_i int;
  v_fixed int := 0; v_skipped int := 0;
BEGIN
  DROP TABLE IF EXISTS cmap;
  CREATE TEMP TABLE cmap(code text, note_type text, nature text);
  INSERT INTO cmap VALUES
    ('NCE_LTB','borrowings','CR'), ('NCE_STB','borrowings','CR'),
    ('BS_NCL_LTB','borrowings','CR'), ('BS_CL_STB','borrowings','CR'),
    ('NCE_OLTL','other_lt_liab','CR'), ('BS_NCL_OLT','other_lt_liab','CR'), ('BS_NCL_DTL','other_lt_liab','CR'),
    ('NCE_LTP','provisions','CR'), ('NCE_STP','provisions','CR'),
    ('BS_NCL_LTP','provisions','CR'), ('BS_CL_STP','provisions','CR'),
    ('NCE_TP','trade_payables','CR'), ('BS_CL_TP','trade_payables','CR'),
    ('BS_CL_TP_MSME','trade_payables','CR'), ('BS_CL_TP_OTH','trade_payables','CR'),
    ('NCE_OCL','other_cl','CR'), ('BS_CL_OCL','other_cl','CR'),
    ('NCE_CWIP','cwip','DR'), ('BS_NCA_FA_WIP','cwip','DR'),
    ('NCE_NCINV','investments','DR'), ('NCE_CINV','investments','DR'),
    ('BS_NCA_INV','investments','DR'), ('BS_CA_CI','investments','DR'),
    ('NCE_LTLA','loans_advances','DR'), ('NCE_STLA','loans_advances','DR'),
    ('BS_NCA_LLA','loans_advances','DR'), ('BS_CA_SLA','loans_advances','DR'),
    ('NCE_ONCA','other_nc_assets','DR'), ('BS_NCA_ONA','other_nc_assets','DR'), ('BS_NCA_DTA','other_nc_assets','DR'),
    ('NCE_TR','trade_receivables','DR'), ('BS_CA_TR','trade_receivables','DR'),
    ('NCE_CASH','cash_bank','DR'), ('BS_CA_CCE','cash_bank','DR'),
    ('NCE_OCA','other_ca','DR'), ('BS_CA_OCA','other_ca','DR'),
    ('NCE_REV_OPS','revenue_ops','CR'), ('PL_REV_OPS','revenue_ops','CR'),
    ('NCE_REV_OTH','other_income','CR'), ('PL_REV_OI','other_income','CR'),
    ('NCE_EMP_EXP','employee_exp','DR'), ('PL_EXP_EMP','employee_exp','DR'),
    ('NCE_FIN_COST','finance_costs','DR'), ('PL_EXP_FIN','finance_costs','DR'),
    ('NCE_OTH_EXP','other_expenses','DR'), ('PL_EXP_OTH','other_expenses','DR'), ('PL_EXP_OEX','other_expenses','DR');

  FOR r IN
    SELECT n.id, n.engagement_id, n.note_type, n.cy_data, n.py_data, ae.client_id
    FROM nce_financial_notes n
    JOIN audit_engagements ae ON ae.id = n.engagement_id
    WHERE n.cy_data ? 'coa_reconcile_balance' OR n.cy_data ? 'coa_reconcile_balance_lt'
       OR n.py_data ? 'coa_reconcile_balance' OR n.py_data ? 'coa_reconcile_balance_lt'
  LOOP
    v_cy := r.cy_data; v_py := r.py_data;
    v_pattern_a := r.note_type IN ('borrowings','provisions','loans_advances','investments');
    v_plug_cy := coalesce((v_cy->>'coa_reconcile_balance')::numeric, (v_cy->>'coa_reconcile_balance_lt')::numeric, 0);
    v_plug_py := coalesce((v_py->>'coa_reconcile_balance')::numeric, (v_py->>'coa_reconcile_balance_lt')::numeric, 0);

    SELECT id INTO v_py_eng FROM audit_engagements
    WHERE client_id = r.client_id AND financial_year = '2024-25' LIMIT 1;

    DROP TABLE IF EXISTS d;
    CREATE TEMP TABLE d AS
    WITH ledgers AS (
      SELECT je.key AS ledger
      FROM audit_engagements ae2, jsonb_each(ae2.coa_mapping) je
      WHERE ae2.id = r.engagement_id
        AND je.value->>'code' IN (SELECT code FROM cmap WHERE note_type = r.note_type)
    ),
    nat AS (SELECT nature FROM cmap WHERE note_type = r.note_type LIMIT 1),
    crow AS (
      SELECT lower(trim(e->>'label')) AS label, e->>'id' AS id
      FROM jsonb_array_elements(coalesce(r.cy_data->'_custom_rows','[]'::jsonb)) e
      WHERE e->>'id' <> 'coa_reconcile_balance'
    )
    SELECT
      lg.ledger,
      coalesce((SELECT CASE WHEN upper(coalesce(t.closing_type,'')) = (SELECT nature FROM nat)
                            THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END
                FROM tally_ledgers t
                WHERE t.engagement_id = r.engagement_id AND lower(t.ledger_name) = lower(lg.ledger)
                  AND t.closing_balance IS NOT NULL LIMIT 1), 0) AS ecy,
      coalesce((SELECT CASE WHEN upper(coalesce(t.closing_type,'')) = (SELECT nature FROM nat)
                            THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END
                FROM tally_ledgers t
                WHERE v_py_eng IS NOT NULL AND t.engagement_id = v_py_eng AND lower(t.ledger_name) = lower(lg.ledger)
                  AND t.closing_balance IS NOT NULL LIMIT 1), 0) AS epy,
      (SELECT cr.id FROM crow cr WHERE cr.label = lower(trim(lg.ledger)) LIMIT 1) AS row_id,
      coalesce((SELECT coalesce((r.cy_data->>(cr.id||'_lt'))::numeric,0)
                     + coalesce((r.cy_data->>(cr.id||'_st'))::numeric,0)
                     + coalesce((r.cy_data->>cr.id)::numeric,0)
                FROM crow cr WHERE cr.label = lower(trim(lg.ledger)) LIMIT 1), 0) AS row_cy,
      coalesce((SELECT coalesce((r.py_data->>(cr.id||'_lt'))::numeric,0)
                     + coalesce((r.py_data->>(cr.id||'_st'))::numeric,0)
                     + coalesce((r.py_data->>cr.id)::numeric,0)
                FROM crow cr WHERE cr.label = lower(trim(lg.ledger)) LIMIT 1), 0) AS row_py,
      coalesce((SELECT sum(coalesce((s->>'amountCy')::numeric,0))
                FROM jsonb_each(coalesce(r.cy_data->'_cy_sources','{}'::jsonb)) cs(k,v), jsonb_array_elements(v) s
                WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger))), 0) AS src_cy,
      coalesce((SELECT sum(coalesce((s->>'amountPy')::numeric,0))
                FROM jsonb_each(coalesce(r.cy_data->'_cy_sources','{}'::jsonb)) cs(k,v), jsonb_array_elements(v) s
                WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger))), 0) AS src_py
    FROM ledgers lg;

    ALTER TABLE d ADD COLUMN dcy numeric; ALTER TABLE d ADD COLUMN dpy numeric;
    UPDATE d SET dcy = round((ecy - row_cy - src_cy)::numeric, 2),
                 dpy = round((epy - row_py - src_py)::numeric, 2);

    SELECT coalesce(sum(dcy),0), coalesce(sum(dpy),0) INTO v_sum_dcy, v_sum_dpy FROM d;

    IF abs(v_sum_dcy - v_plug_cy) > 1 OR abs(v_sum_dpy - v_plug_py) > 1 THEN
      RAISE NOTICE 'SKIP  eng=% note=%  delta-sum cy=% py=%  plug cy=% py=%',
        r.engagement_id, r.note_type, v_sum_dcy, v_sum_dpy, v_plug_cy, v_plug_py;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_i := 0;
    FOR l IN SELECT * FROM d WHERE abs(dcy) > 0.005 OR abs(dpy) > 0.005 ORDER BY ledger LOOP
      IF l.row_id IS NOT NULL THEN
        -- adjust the existing real row
        v_key := CASE WHEN v_pattern_a THEN l.row_id || '_lt' ELSE l.row_id END;
        v_cur := coalesce((v_cy->>v_key)::numeric, CASE WHEN v_pattern_a THEN (v_cy->>l.row_id)::numeric END, 0);
        v_cy  := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(round(v_cur + l.dcy, 2)));
        IF v_pattern_a AND v_cy ? l.row_id THEN v_cy := v_cy - l.row_id; END IF;
        v_cur := coalesce((v_py->>v_key)::numeric, CASE WHEN v_pattern_a THEN (v_py->>l.row_id)::numeric END, 0);
        v_py  := jsonb_set(v_py, ARRAY[v_key], to_jsonb(round(v_cur + l.dpy, 2)));
        IF v_pattern_a AND v_py ? l.row_id THEN v_py := v_py - l.row_id; END IF;
      ELSIF abs(l.src_cy) > 0.005 OR abs(l.src_py) > 0.005 THEN
        -- ledger tracked inside a static row's _cy_sources: adjust the static
        -- row's own value; the sources stay as the (partial) detail.
        SELECT cs.k INTO v_key
        FROM jsonb_each(coalesce(v_cy->'_cy_sources','{}'::jsonb)) cs(k,v), jsonb_array_elements(cs.v) s
        WHERE lower(trim(s->>'ledger')) = lower(trim(l.ledger)) LIMIT 1;
        IF v_key IS NOT NULL THEN
          v_cur := coalesce((v_cy->>v_key)::numeric, 0);
          v_cy  := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(round(v_cur + l.dcy, 2)));
          v_cur := coalesce((v_py->>v_key)::numeric, 0);
          v_py  := jsonb_set(v_py, ARRAY[v_key], to_jsonb(round(v_cur + l.dpy, 2)));
        END IF;
      ELSE
        -- no row at all: create a REAL per-ledger row carrying the TB values
        v_i := v_i + 1;
        v_slug := 'custom_tb_' || substr(md5(l.ledger), 1, 10) || '_' || v_i;
        v_cy := jsonb_set(v_cy, '{_custom_rows}',
          coalesce(v_cy->'_custom_rows','[]'::jsonb) || jsonb_build_array(
            jsonb_build_object('id', v_slug, 'label', l.ledger, 'source', 'auto', 'tbDerived', true)));
        v_key := CASE WHEN v_pattern_a THEN v_slug || '_lt' ELSE v_slug END;
        v_cy := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(round(l.ecy, 2)));
        v_py := jsonb_set(v_py, ARRAY[v_key], to_jsonb(round(l.epy, 2)));
      END IF;
    END LOOP;

    -- remove the plug entirely (keys + customRow entry)
    v_cy := v_cy - 'coa_reconcile_balance' - 'coa_reconcile_balance_lt';
    v_py := v_py - 'coa_reconcile_balance' - 'coa_reconcile_balance_lt';
    v_cy := jsonb_set(v_cy, '{_custom_rows}', (
      SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_cy->'_custom_rows','[]'::jsonb)) e
      WHERE e->>'id' <> 'coa_reconcile_balance'));

    UPDATE nce_financial_notes SET cy_data = v_cy, py_data = v_py, updated_at = now()
    WHERE id = r.id;
    v_fixed := v_fixed + 1;
    RAISE NOTICE 'FIXED eng=% note=%  (plug cy=% py=% replaced by real rows)',
      r.engagement_id, r.note_type, v_plug_cy, v_plug_py;
  END LOOP;

  RAISE NOTICE 'DONE: % fixed, % skipped', v_fixed, v_skipped;
END $$;
