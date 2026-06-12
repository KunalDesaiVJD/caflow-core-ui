WITH note AS (
  SELECT n.* FROM nce_financial_notes n
  WHERE n.engagement_id='6074f0fb-679a-4b88-98a6-c421cfcf8e0a' AND n.note_type='other_expenses'
),
ledgers AS (
  SELECT je.key as ledger
  FROM audit_engagements ae, jsonb_each(ae.coa_mapping) je
  WHERE ae.id='6074f0fb-679a-4b88-98a6-c421cfcf8e0a'
    AND je.value->>'code' IN ('NCE_OTH_EXP','PL_EXP_OTH','PL_EXP_OEX')
),
expected AS (
  SELECT l.ledger,
    coalesce((SELECT CASE WHEN upper(t.closing_type)='DR' THEN t.closing_balance::numeric ELSE -t.closing_balance::numeric END
              FROM tally_ledgers t WHERE t.engagement_id='6074f0fb-679a-4b88-98a6-c421cfcf8e0a'
                AND lower(t.ledger_name)=lower(l.ledger) LIMIT 1),0) as ecy,
    coalesce((SELECT CASE WHEN upper(t.closing_type)='DR' THEN t.closing_balance::numeric ELSE -t.closing_balance::numeric END
              FROM tally_ledgers t WHERE t.engagement_id='49482a0b-d234-4316-ae99-9757da27bc11'
                AND lower(t.ledger_name)=lower(l.ledger) LIMIT 1),0) as epy
  FROM ledgers l
),
crow AS (
  SELECT lower(trim(e->>'label')) as label, e->>'id' as id
  FROM note, jsonb_array_elements(note.cy_data->'_custom_rows') e
  WHERE e->>'id' != 'coa_reconcile_balance'
),
attributed AS (
  SELECT x.ledger, x.ecy, x.epy,
    (SELECT cr.id FROM crow cr WHERE cr.label = lower(trim(x.ledger)) LIMIT 1) as row_id,
    coalesce((SELECT (note.cy_data->>cr.id)::numeric FROM crow cr WHERE cr.label = lower(trim(x.ledger)) LIMIT 1),0) as row_cy,
    coalesce((SELECT (note.py_data->>cr.id)::numeric FROM crow cr WHERE cr.label = lower(trim(x.ledger)) LIMIT 1),0) as row_py,
    coalesce((SELECT sum((s->>'amountCy')::numeric)
              FROM jsonb_each(note.cy_data->'_cy_sources') cs(k,v), jsonb_array_elements(v) s
              WHERE lower(trim(s->>'ledger'))=lower(trim(x.ledger))),0) as src_cy,
    coalesce((SELECT sum(coalesce((s->>'amountPy')::numeric,0))
              FROM jsonb_each(note.cy_data->'_cy_sources') cs(k,v), jsonb_array_elements(v) s
              WHERE lower(trim(s->>'ledger'))=lower(trim(x.ledger))),0) as src_py
  FROM expected x, note
)
SELECT ledger, ecy, epy, (row_id IS NOT NULL) as has_row, row_cy, row_py, src_cy, src_py,
  round((ecy - row_cy - src_cy)::numeric,2) as dcy,
  round((epy - row_py - src_py)::numeric,2) as dpy
FROM attributed
WHERE abs(ecy - row_cy - src_cy) > 1 OR abs(epy - row_py - src_py) > 1
ORDER BY ledger
