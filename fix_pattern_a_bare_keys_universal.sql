-- RC-10 universal migration: ANY bare numeric key on a Pattern A note
-- (borrowings / provisions / loans_advances / investments) that has no
-- _lt/_st suffixed twin is invisible to the Notes UI renderer while still
-- counted by the canonical aggregator → on-screen total ≠ BS face.
-- (BHAKTI's coa_reconcile_balance was instance #1; BRICKSTONE's Pattern G
-- custom_g_* rows are the same class.)
-- Moves each such bare value to <key>_lt. Canonical totals are unchanged
-- (the bare-key fallback already landed these in the LT column) — this is
-- purely a visibility fix. Idempotent.
WITH pattern_a_notes AS (
  SELECT id, cy_data, py_data FROM nce_financial_notes
  WHERE note_type IN ('borrowings','provisions','loans_advances','investments')
),
cy_moves AS (
  SELECT n.id, k, v
  FROM pattern_a_notes n, jsonb_each(n.cy_data) x(k, v)
  WHERE substring(k,1,1) != '_'
    AND k NOT LIKE '%!_lt' ESCAPE '!'
    AND k NOT LIKE '%!_st' ESCAPE '!'
    AND jsonb_typeof(v) = 'number'
    AND (v)::text::numeric != 0
    AND NOT (n.cy_data ? (k || '_lt'))
    AND NOT (n.cy_data ? (k || '_st'))
),
py_moves AS (
  SELECT n.id, k, v
  FROM pattern_a_notes n, jsonb_each(n.py_data) x(k, v)
  WHERE substring(k,1,1) != '_'
    AND k NOT LIKE '%!_lt' ESCAPE '!'
    AND k NOT LIKE '%!_st' ESCAPE '!'
    AND jsonb_typeof(v) = 'number'
    AND (v)::text::numeric != 0
    AND NOT (n.py_data ? (k || '_lt'))
    AND NOT (n.py_data ? (k || '_st'))
),
cy_agg AS (
  SELECT id,
    jsonb_object_agg(k || '_lt', v) as add_keys,
    array_agg(k) as drop_keys
  FROM cy_moves GROUP BY id
),
py_agg AS (
  SELECT id,
    jsonb_object_agg(k || '_lt', v) as add_keys,
    array_agg(k) as drop_keys
  FROM py_moves GROUP BY id
),
upd_cy AS (
  UPDATE nce_financial_notes n SET
    cy_data = (n.cy_data - a.drop_keys) || a.add_keys,
    updated_at = now()
  FROM cy_agg a WHERE n.id = a.id
  RETURNING n.id
),
upd_py AS (
  UPDATE nce_financial_notes n SET
    py_data = (n.py_data - a.drop_keys) || a.add_keys,
    updated_at = now()
  FROM py_agg a WHERE n.id = a.id
  RETURNING n.id
)
SELECT
  (SELECT count(*) FROM upd_cy) as notes_cy_migrated,
  (SELECT count(*) FROM upd_py) as notes_py_migrated,
  (SELECT count(*) FROM cy_moves) as cy_keys_moved,
  (SELECT count(*) FROM py_moves) as py_keys_moved
