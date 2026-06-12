-- Phase-by-phase debug on AMBER GUM borrowings (no UPDATE — read-only)
DO $$
DECLARE
  r record; l record;
  v_cy jsonb; v_py jsonb;
  v_pattern_a boolean := true;
  v_py_eng uuid;
  v_key text; v_cur numeric; v_slug text; v_i int := 0;
  s numeric;
BEGIN
  DROP TABLE IF EXISTS dbg; CREATE TABLE dbg(phase text, cy_sum numeric, py_sum numeric, n_keys int);

  SELECT n.*, ae.client_id INTO r
  FROM nce_financial_notes n JOIN audit_engagements ae ON ae.id=n.engagement_id
  WHERE n.engagement_id='8b0b22b3-04a7-4225-a646-d9f5a842625a' AND n.note_type='borrowings';

  v_cy := r.cy_data; v_py := r.py_data;

  SELECT coalesce(sum((x.v)::numeric),0) INTO s FROM jsonb_each_text(v_cy) x(k,v)
  WHERE substring(x.k,1,1) <> '_' AND x.v ~ '^-?[0-9]';
  INSERT INTO dbg SELECT 'start_cy', s, null, (SELECT count(*) FROM jsonb_object_keys(v_cy));

  SELECT id INTO v_py_eng FROM audit_engagements
  WHERE client_id = r.client_id AND financial_year = '2024-25' LIMIT 1;

  DROP TABLE IF EXISTS d;
  CREATE TEMP TABLE d AS
  WITH ledgers AS (
    SELECT DISTINCT ON (lower(trim(je.key))) je.key AS ledger
    FROM audit_engagements ae2, jsonb_each(ae2.coa_mapping) je
    WHERE ae2.id = r.engagement_id
      AND je.value->>'code' IN ('NCE_LTB','NCE_STB','BS_NCL_LTB','BS_CL_STB')
    ORDER BY lower(trim(je.key)), je.key
  ),
  crow AS (
    SELECT lower(trim(e->>'label')) AS label, e->>'id' AS id
    FROM jsonb_array_elements(coalesce(r.cy_data->'_custom_rows','[]'::jsonb)) e
    WHERE e->>'id' <> 'coa_reconcile_balance'
  )
  SELECT lg.ledger,
    coalesce((SELECT CASE WHEN upper(coalesce(t.closing_type,''))='CR' THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END
              FROM tally_ledgers t WHERE t.engagement_id=r.engagement_id AND lower(t.ledger_name)=lower(trim(lg.ledger)) LIMIT 1),0) AS ecy,
    coalesce((SELECT CASE WHEN upper(coalesce(t.closing_type,''))='CR' THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END
              FROM tally_ledgers t WHERE t.engagement_id=v_py_eng AND lower(t.ledger_name)=lower(trim(lg.ledger)) LIMIT 1),0) AS epy,
    (SELECT cr.id FROM crow cr WHERE cr.label = lower(trim(lg.ledger)) LIMIT 1) AS row_id,
    coalesce((SELECT coalesce((r.cy_data->>(cr.id||'_lt'))::numeric,0)
                   + coalesce((r.cy_data->>(cr.id||'_st'))::numeric,0)
                   + coalesce((r.cy_data->>cr.id)::numeric,0)
              FROM crow cr WHERE cr.label = lower(trim(lg.ledger)) LIMIT 1), 0) AS row_cy,
    coalesce((SELECT coalesce((r.py_data->>(cr.id||'_lt'))::numeric,0)
                   + coalesce((r.py_data->>(cr.id||'_st'))::numeric,0)
                   + coalesce((r.py_data->>cr.id)::numeric,0)
              FROM crow cr WHERE cr.label = lower(trim(lg.ledger)) LIMIT 1), 0) AS row_py
  FROM ledgers lg;

  ALTER TABLE d ADD COLUMN dcy numeric; ALTER TABLE d ADD COLUMN dpy numeric;
  UPDATE d SET dcy = round((ecy - row_cy)::numeric,2), dpy = round((epy - row_py)::numeric,2);

  INSERT INTO dbg SELECT 'd_built', (SELECT sum(ecy) FROM d), (SELECT sum(epy) FROM d), (SELECT count(*) FROM d);

  FOR l IN SELECT * FROM d WHERE abs(dcy) > 0.005 OR abs(dpy) > 0.005 ORDER BY ledger LOOP
    IF l.row_id IS NOT NULL THEN
      v_key := l.row_id || '_lt';
      v_cur := coalesce((v_cy->>v_key)::numeric, (v_cy->>l.row_id)::numeric, 0);
      v_cy  := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(round(v_cur + l.dcy, 2)));
      v_cur := coalesce((v_py->>v_key)::numeric, (v_py->>l.row_id)::numeric, 0);
      v_py  := jsonb_set(v_py, ARRAY[v_key], to_jsonb(round(v_cur + l.dpy, 2)));
    ELSE
      v_i := v_i + 1;
      v_slug := 'custom_tb_' || substr(md5(l.ledger), 1, 10) || '_' || v_i;
      v_cy := jsonb_set(v_cy, '{_custom_rows}',
        coalesce(v_cy->'_custom_rows','[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('id', v_slug, 'label', l.ledger, 'source', 'auto', 'tbDerived', true)));
      v_key := v_slug || '_lt';
      v_cy := jsonb_set(v_cy, ARRAY[v_key], to_jsonb(round(l.ecy, 2)));
      v_py := jsonb_set(v_py, ARRAY[v_key], to_jsonb(round(l.epy, 2)));
    END IF;
  END LOOP;

  SELECT coalesce(sum((x.v)::numeric),0) INTO s FROM jsonb_each_text(v_cy) x(k,v)
  WHERE substring(x.k,1,1) <> '_' AND x.v ~ '^-?[0-9]';
  INSERT INTO dbg SELECT 'post_fwd_cy', s, null, (SELECT count(*) FROM jsonb_object_keys(v_cy));

  v_cy := v_cy - 'coa_reconcile_balance' - 'coa_reconcile_balance_lt';
  v_py := v_py - 'coa_reconcile_balance' - 'coa_reconcile_balance_lt';

  SELECT coalesce(sum((x.v)::numeric),0) INTO s FROM jsonb_each_text(v_cy) x(k,v)
  WHERE substring(x.k,1,1) <> '_' AND x.v ~ '^-?[0-9]';
  INSERT INTO dbg SELECT 'post_plugrm_cy', s, null, (SELECT count(*) FROM jsonb_object_keys(v_cy));

  SELECT coalesce(sum((x.v)::numeric),0) INTO s FROM jsonb_each_text(v_py) x(k,v)
  WHERE substring(x.k,1,1) <> '_' AND x.v ~ '^-?[0-9]';
  INSERT INTO dbg SELECT 'final_py', null, s, (SELECT count(*) FROM jsonb_object_keys(v_py));
END $$;
SELECT * FROM dbg;
