-- Per-ledger reconstruction v3 — adds the two missing attribution channels:
--   (a) custom-row sources[] arrays (merged rows like "Sample House Expense"
--       that aggregate several TB ledgers) — deltas adjust the row AND its
--       sources entries so the load-time heal stays consistent;
--   (b) REV pass — rows attached to nothing real (label matches no mapped
--       ledger AND sources contain no mapped ledger) are zeroed, recorded
--       in a notice; junk rows like MAHIL's "B" (PY ₹44.8L) die here.
-- POST-FIX ASSERTION unchanged: note sum must equal deduped COA, both years.
DO $$
DECLARE
  r record; l record; z record;
  v_cy jsonb; v_py jsonb;
  v_pattern_a boolean;
  v_py_eng uuid;
  v_key text; v_cur numeric; v_slug text; v_i int;
  v_coa_cy numeric; v_coa_py numeric;
  v_new_cy numeric; v_new_py numeric;
  v_srcrow text; v_newsrc jsonb;
  v_fixed int := 0; v_skipped int := 0;
BEGIN
  DROP TABLE IF EXISTS fix_report;
  CREATE TABLE fix_report(eng uuid, note text, status text, post_cy numeric, coa_cy numeric, post_py numeric, coa_py numeric, detail text);
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

    SELECT id INTO v_py_eng FROM audit_engagements
    WHERE client_id = r.client_id AND financial_year = '2024-25' LIMIT 1;

    DROP TABLE IF EXISTS d;
    CREATE TEMP TABLE d AS
    WITH ledgers AS (
      SELECT DISTINCT ON (lower(trim(je.key))) je.key AS ledger
      FROM audit_engagements ae2, jsonb_each(ae2.coa_mapping) je
      WHERE ae2.id = r.engagement_id
        AND je.value->>'code' IN (SELECT code FROM cmap WHERE note_type = r.note_type)
      ORDER BY lower(trim(je.key)), je.key
    ),
    nat AS (SELECT nature FROM cmap WHERE note_type = r.note_type LIMIT 1),
    crow AS (
      SELECT lower(trim(e->>'label')) AS label, e->>'id' AS id, e AS obj
      FROM jsonb_array_elements(coalesce(r.cy_data->'_custom_rows','[]'::jsonb)) e
      WHERE e->>'id' <> 'coa_reconcile_balance'
    )
    SELECT
      lg.ledger,
      coalesce((SELECT CASE WHEN upper(coalesce(t.closing_type,'')) = (SELECT nature FROM nat)
                            THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END
                FROM tally_ledgers t
                WHERE t.engagement_id = r.engagement_id AND lower(t.ledger_name) = lower(trim(lg.ledger))
                  AND t.closing_balance IS NOT NULL LIMIT 1), 0) AS ecy,
      CASE WHEN v_py_eng IS NOT NULL THEN
        coalesce((SELECT CASE WHEN upper(coalesce(t.closing_type,'')) = (SELECT nature FROM nat)
                              THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END
                  FROM tally_ledgers t
                  WHERE t.engagement_id = v_py_eng AND lower(t.ledger_name) = lower(trim(lg.ledger))
                    AND t.closing_balance IS NOT NULL LIMIT 1), 0)
      ELSE
        coalesce((SELECT CASE WHEN upper(coalesce(t.opening_type,'')) = (SELECT nature FROM nat)
                              THEN abs(t.opening_balance::numeric) ELSE -abs(t.opening_balance::numeric) END
                  FROM tally_ledgers t
                  WHERE t.engagement_id = r.engagement_id AND lower(t.ledger_name) = lower(trim(lg.ledger))
                    AND t.opening_balance IS NOT NULL LIMIT 1), 0)
      END AS epy,
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
                WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger))), 0) AS meta_cy,
      coalesce((SELECT sum(coalesce((s->>'amountPy')::numeric,0))
                FROM jsonb_each(coalesce(r.cy_data->'_cy_sources','{}'::jsonb)) cs(k,v), jsonb_array_elements(v) s
                WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger))), 0) AS meta_py,
      (SELECT cs.k FROM jsonb_each(coalesce(r.cy_data->'_cy_sources','{}'::jsonb)) cs(k,v), jsonb_array_elements(cs.v) s
       WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger)) LIMIT 1) AS meta_row,
      -- custom-row sources[] attribution (merged rows) — pick FIRST row whose
      -- sources contain this ledger; only count rows NOT already label-matched
      (SELECT cr.id FROM crow cr, jsonb_array_elements(coalesce(cr.obj->'sources','[]'::jsonb)) s
       WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger))
         AND cr.label <> lower(trim(lg.ledger)) LIMIT 1) AS srcs_row,
      coalesce((SELECT sum(coalesce((s->>'amountCy')::numeric,0))
                FROM crow cr, jsonb_array_elements(coalesce(cr.obj->'sources','[]'::jsonb)) s
                WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger))
                  AND cr.label <> lower(trim(lg.ledger))), 0) AS srcs_cy,
      coalesce((SELECT sum(coalesce((s->>'amountPy')::numeric,0))
                FROM crow cr, jsonb_array_elements(coalesce(cr.obj->'sources','[]'::jsonb)) s
                WHERE lower(trim(s->>'ledger')) = lower(trim(lg.ledger))
                  AND cr.label <> lower(trim(lg.ledger))), 0) AS srcs_py
    FROM ledgers lg;

    ALTER TABLE d ADD COLUMN dcy numeric; ALTER TABLE d ADD COLUMN dpy numeric;
    -- PRIORITY attribution (not SUM): a ledger's presence in the note is its
    -- label-matched row value; the row's sources[] / _cy_sources entries are
    -- the COMPOSITION of that value, not additional amounts. Summing both
    -- double-subtracts (AMBER GUM Pattern G rows are tracked in both).
    UPDATE d SET
      dcy = round((ecy - CASE WHEN row_id IS NOT NULL THEN row_cy
                              WHEN srcs_row IS NOT NULL THEN srcs_cy
                              WHEN meta_row IS NOT NULL THEN meta_cy
                              ELSE 0 END)::numeric, 2),
      dpy = round((epy - CASE WHEN row_id IS NOT NULL THEN row_py
                              WHEN srcs_row IS NOT NULL THEN srcs_py
                              WHEN meta_row IS NOT NULL THEN meta_py
                              ELSE 0 END)::numeric, 2);

    SELECT coalesce(sum(ecy),0), coalesce(sum(epy),0) INTO v_coa_cy, v_coa_py FROM d;

    -- FWD apply
    v_i := 0;
    FOR l IN SELECT * FROM d WHERE abs(dcy) > 0.005 OR abs(dpy) > 0.005 ORDER BY ledger LOOP
      IF l.row_id IS NOT NULL THEN
        v_key := CASE WHEN v_pattern_a THEN l.row_id || '_lt' ELSE l.row_id END;
        v_cur := coalesce((v_cy->>v_key)::numeric, CASE WHEN v_pattern_a THEN (v_cy->>l.row_id)::numeric END, 0);
        v_cy  := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(round(v_cur + l.dcy, 2)));
        IF v_pattern_a AND v_cy ? l.row_id THEN v_cy := v_cy - l.row_id; END IF;
        v_cur := coalesce((v_py->>v_key)::numeric, CASE WHEN v_pattern_a THEN (v_py->>l.row_id)::numeric END, 0);
        v_py  := jsonb_set(v_py, ARRAY[v_key], to_jsonb(round(v_cur + l.dpy, 2)));
        IF v_pattern_a AND v_py ? l.row_id THEN v_py := v_py - l.row_id; END IF;
      ELSIF l.srcs_row IS NOT NULL THEN
        -- merged custom row: adjust the row value AND its sources entry
        v_key := CASE WHEN v_pattern_a THEN l.srcs_row || '_lt' ELSE l.srcs_row END;
        v_cur := coalesce((v_cy->>v_key)::numeric, CASE WHEN v_pattern_a THEN (v_cy->>l.srcs_row)::numeric END, 0);
        v_cy  := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(round(v_cur + l.dcy, 2)));
        v_cur := coalesce((v_py->>v_key)::numeric, CASE WHEN v_pattern_a THEN (v_py->>l.srcs_row)::numeric END, 0);
        v_py  := jsonb_set(v_py, ARRAY[v_key], to_jsonb(round(v_cur + l.dpy, 2)));
        -- rebuild this row's sources with adjusted amounts for the ledger
        SELECT jsonb_agg(
                 CASE WHEN lower(trim(s->>'ledger')) = lower(trim(l.ledger))
                      THEN s || jsonb_build_object(
                             'amountCy', round(coalesce((s->>'amountCy')::numeric,0) + l.dcy, 2),
                             'amountPy', round(coalesce((s->>'amountPy')::numeric,0) + l.dpy, 2))
                      ELSE s END)
          INTO v_newsrc
        FROM jsonb_array_elements(
               (SELECT e->'sources' FROM jsonb_array_elements(v_cy->'_custom_rows') e
                WHERE e->>'id' = l.srcs_row)) s;
        IF v_newsrc IS NOT NULL THEN
          v_cy := jsonb_set(v_cy, '{_custom_rows}', (
            SELECT jsonb_agg(CASE WHEN e->>'id' = l.srcs_row
                                  THEN jsonb_set(e, '{sources}', v_newsrc) ELSE e END)
            FROM jsonb_array_elements(v_cy->'_custom_rows') e));
        END IF;
      ELSIF l.meta_row IS NOT NULL THEN
        IF true THEN
          v_cur := coalesce((v_cy->>l.meta_row)::numeric, 0);
          v_cy  := jsonb_set(v_cy, ARRAY[l.meta_row], to_jsonb(round(v_cur + l.dcy, 2)));
          v_cur := coalesce((v_py->>l.meta_row)::numeric, 0);
          v_py  := jsonb_set(v_py, ARRAY[l.meta_row], to_jsonb(round(v_cur + l.dpy, 2)));
        END IF;
      ELSE
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

    -- REV pass: zero rows with NO mapped attribution at all
    FOR z IN
      SELECT e->>'id' AS id, e->>'label' AS label
      FROM jsonb_array_elements(v_cy->'_custom_rows') e
      WHERE e->>'id' <> 'coa_reconcile_balance'
        AND NOT EXISTS (SELECT 1 FROM d WHERE lower(trim(d.ledger)) = lower(trim(e->>'label')))
        AND NOT EXISTS (SELECT 1 FROM d, jsonb_array_elements(coalesce(e->'sources','[]'::jsonb)) s
                        WHERE lower(trim(s->>'ledger')) = lower(trim(d.ledger)))
        AND ( abs(coalesce((v_cy->>((e->>'id')||'_lt'))::numeric,0)+coalesce((v_cy->>((e->>'id')||'_st'))::numeric,0)+coalesce((v_cy->>(e->>'id'))::numeric,0)) > 0.005
           OR abs(coalesce((v_py->>((e->>'id')||'_lt'))::numeric,0)+coalesce((v_py->>((e->>'id')||'_st'))::numeric,0)+coalesce((v_py->>(e->>'id'))::numeric,0)) > 0.005 )
    LOOP
      RAISE NOTICE 'ZEROED stale row eng=% note=% label=%', r.engagement_id, r.note_type, z.label;
      FOR v_key IN SELECT unnest(ARRAY[z.id, z.id||'_lt', z.id||'_st']) LOOP
        IF v_cy ? v_key THEN v_cy := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(0)); END IF;
        IF v_py ? v_key THEN v_py := jsonb_set(v_py, ARRAY[v_key], to_jsonb(0)); END IF;
      END LOOP;
      -- zero sources amounts so the load-time heal can't resurrect the value
      v_cy := jsonb_set(v_cy, '{_custom_rows}', (
        SELECT jsonb_agg(CASE WHEN e2->>'id' = z.id AND e2 ? 'sources'
          THEN jsonb_set(e2, '{sources}', (
                 SELECT coalesce(jsonb_agg(s || jsonb_build_object('amountCy',0,'amountPy',0)),'[]'::jsonb)
                 FROM jsonb_array_elements(e2->'sources') s))
          ELSE e2 END)
        FROM jsonb_array_elements(v_cy->'_custom_rows') e2));
    END LOOP;

    -- remove the plug
    v_cy := v_cy - 'coa_reconcile_balance' - 'coa_reconcile_balance_lt';
    v_py := v_py - 'coa_reconcile_balance' - 'coa_reconcile_balance_lt';
    v_cy := jsonb_set(v_cy, '{_custom_rows}', (
      SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_cy->'_custom_rows','[]'::jsonb)) e
      WHERE e->>'id' <> 'coa_reconcile_balance'));

    -- POST-FIX ASSERTION
    SELECT coalesce(sum((x.v)::numeric),0) INTO v_new_cy
    FROM jsonb_each_text(v_cy) x(k,v) WHERE substring(x.k,1,1) <> '_' AND x.v ~ '^-?[0-9]';
    SELECT coalesce(sum((x.v)::numeric),0) INTO v_new_py
    FROM jsonb_each_text(v_py) x(k,v) WHERE substring(x.k,1,1) <> '_' AND x.v ~ '^-?[0-9]';

    IF abs(v_new_cy - v_coa_cy) > 1 OR abs(v_new_py - v_coa_py) > 1 THEN
      INSERT INTO fix_report VALUES (r.engagement_id, r.note_type, 'SKIP', v_new_cy, v_coa_cy, v_new_py, v_coa_py, null);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE nce_financial_notes SET cy_data = v_cy, py_data = v_py, updated_at = now()
    WHERE id = r.id;
    INSERT INTO fix_report VALUES (r.engagement_id, r.note_type, 'FIXED', v_new_cy, v_coa_cy, v_new_py, v_coa_py, null);
    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'DONE: % fixed, % skipped', v_fixed, v_skipped;
END $$;
