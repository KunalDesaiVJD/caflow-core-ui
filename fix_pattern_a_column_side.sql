-- Pattern A column placement: a row whose ledger is ST-coded (NCE_STP /
-- NCE_STB / NCE_CINV / NCE_STLA + corporate twins) must hold its value in
-- the _st key, LT-coded in _lt. My fix scripts hardcoded _lt; combined
-- totals were right but the per-column BS face mis-placed (SHRI RAM
-- ST-provision ₹10,000 showing under Long-term provisions).
-- Moves the value only when the target-side key is absent/zero. Idempotent.
DO $$
DECLARE
  r record; l record;
  v_cy jsonb; v_py jsonb; v_changed boolean;
  v_from text; v_to text; v_val numeric;
  v_moves int := 0;
BEGIN
  DROP TABLE IF EXISTS side_map;
  CREATE TEMP TABLE side_map(code text, note_type text, side text);
  INSERT INTO side_map VALUES
    ('NCE_LTB','borrowings','lt'), ('BS_NCL_LTB','borrowings','lt'),
    ('NCE_STB','borrowings','st'), ('BS_CL_STB','borrowings','st'),
    ('NCE_LTP','provisions','lt'), ('BS_NCL_LTP','provisions','lt'),
    ('NCE_STP','provisions','st'), ('BS_CL_STP','provisions','st'),
    ('NCE_NCINV','investments','lt'), ('BS_NCA_INV','investments','lt'),
    ('NCE_CINV','investments','st'), ('BS_CA_CI','investments','st'),
    ('NCE_LTLA','loans_advances','lt'), ('BS_NCA_LLA','loans_advances','lt'),
    ('NCE_STLA','loans_advances','st'), ('BS_CA_SLA','loans_advances','st');

  FOR r IN
    SELECT n.id, n.engagement_id, n.note_type, n.cy_data, n.py_data, ae.client_id
    FROM nce_financial_notes n
    JOIN audit_engagements ae ON ae.id = n.engagement_id
    JOIN clients c ON c.id = ae.client_id
    WHERE ae.financial_year = '2025-26'
      AND c.entity_type IN ('Partnership','Individual','HUF','AOP','Trust','LLP','Proprietorship')
      AND n.note_type IN ('borrowings','provisions','investments','loans_advances')
  LOOP
    v_cy := r.cy_data; v_py := r.py_data; v_changed := false;

    FOR l IN
      WITH picked AS (
        SELECT DISTINCT ON (lower(trim(je.key))) je.key AS ledger, je.value->>'code' AS code
        FROM audit_engagements ae2, jsonb_each(ae2.coa_mapping) je
        WHERE ae2.id = r.engagement_id
        ORDER BY lower(trim(je.key)),
          (EXISTS (SELECT 1 FROM tally_ledgers t WHERE t.engagement_id = r.engagement_id AND t.ledger_name = je.key)) DESC,
          je.key
      )
      SELECT p.ledger, sm.side, cr.id AS row_id
      FROM picked p
      JOIN side_map sm ON sm.code = p.code AND sm.note_type = r.note_type
      JOIN LATERAL (
        SELECT e->>'id' AS id FROM jsonb_array_elements(coalesce(r.cy_data->'_custom_rows','[]'::jsonb)) e
        WHERE lower(trim(e->>'label')) = lower(trim(p.ledger)) LIMIT 1
      ) cr ON true
    LOOP
      v_from := l.row_id || CASE WHEN l.side = 'st' THEN '_lt' ELSE '_st' END;
      v_to   := l.row_id || '_' || l.side;
      -- CY move
      v_val := coalesce((v_cy->>v_from)::numeric, 0);
      IF abs(v_val) > 0.005 AND abs(coalesce((v_cy->>v_to)::numeric,0)) < 0.005 THEN
        v_cy := jsonb_set(v_cy - v_from, ARRAY[v_to], to_jsonb(v_val));
        v_changed := true; v_moves := v_moves + 1;
      END IF;
      -- PY move
      v_val := coalesce((v_py->>v_from)::numeric, 0);
      IF abs(v_val) > 0.005 AND abs(coalesce((v_py->>v_to)::numeric,0)) < 0.005 THEN
        v_py := jsonb_set(v_py - v_from, ARRAY[v_to], to_jsonb(v_val));
        v_changed := true; v_moves := v_moves + 1;
      END IF;
    END LOOP;

    IF v_changed THEN
      UPDATE nce_financial_notes SET cy_data = v_cy, py_data = v_py, updated_at = now()
      WHERE id = r.id;
      RAISE NOTICE 'moved sides eng=% note=%', r.engagement_id, r.note_type;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL side moves: %', v_moves;
END $$;
