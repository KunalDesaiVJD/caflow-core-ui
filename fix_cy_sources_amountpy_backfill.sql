-- RC-11 companion data fix: legacy _cy_sources entries carry only amountCy.
-- For SINGLE-source static rows the row's saved py value belongs entirely to
-- that one ledger — backfill amountPy so the expanded sub-row displays the
-- PY column and any sources-based aggregation reproduces the saved value.
-- Multi-source rows are left untouched (cannot split reliably); the code
-- guard (anyPyDefined) protects those from the destructive heal.
-- Idempotent: entries that already have amountPy are skipped.
WITH candidates AS (
  SELECT n.id, n.note_type, src.key as row_id,
         src.value as sources,
         (n.py_data->>src.key)::numeric as py_val
  FROM nce_financial_notes n,
       jsonb_each(n.cy_data->'_cy_sources') src(key, value)
  WHERE n.cy_data ? '_cy_sources'
    AND jsonb_typeof(src.value) = 'array'
    AND jsonb_array_length(src.value) = 1
    AND NOT (src.value->0 ? 'amountPy')
    AND n.py_data ? src.key
    AND (n.py_data->>src.key) ~ '^-?[0-9]'
    AND abs((n.py_data->>src.key)::numeric) > 0.005
),
rebuilt AS (
  SELECT id,
    jsonb_object_agg(
      row_id,
      jsonb_build_array(sources->0 || jsonb_build_object('amountPy', py_val))
    ) as patched_sources
  FROM candidates
  GROUP BY id
),
updated AS (
  UPDATE nce_financial_notes n SET
    cy_data = jsonb_set(
      n.cy_data,
      ARRAY['_cy_sources'],
      coalesce(n.cy_data->'_cy_sources', '{}'::jsonb) || r.patched_sources
    ),
    updated_at = now()
  FROM rebuilt r
  WHERE n.id = r.id
  RETURNING n.id
)
SELECT
  (SELECT count(*) FROM updated) as notes_patched,
  (SELECT count(*) FROM candidates) as source_entries_backfilled
