WITH note AS (
  SELECT n.*, ae.client_id FROM nce_financial_notes n JOIN audit_engagements ae ON ae.id=n.engagement_id
  WHERE n.engagement_id='8b0b22b3-04a7-4225-a646-d9f5a842625a' AND n.note_type='borrowings'
),
pyeng AS (SELECT id FROM audit_engagements WHERE client_id=(SELECT client_id FROM note) AND financial_year='2024-25' LIMIT 1),
ledgers AS (
  SELECT DISTINCT ON (lower(trim(je.key))) je.key as ledger
  FROM audit_engagements ae, jsonb_each(ae.coa_mapping) je
  WHERE ae.id='8b0b22b3-04a7-4225-a646-d9f5a842625a'
    AND je.value->>'code' IN ('NCE_LTB','NCE_STB','BS_NCL_LTB','BS_CL_STB')
  ORDER BY lower(trim(je.key)), je.key
),
crow AS (
  SELECT lower(trim(e->>'label')) as label, e->>'id' as id, e as obj
  FROM note, jsonb_array_elements(note.cy_data->'_custom_rows') e
  WHERE e->>'id' != 'coa_reconcile_balance'
)
SELECT 'L' as k, l.ledger as item,
  coalesce((SELECT CASE WHEN upper(t.closing_type)='CR' THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END FROM tally_ledgers t WHERE t.engagement_id='8b0b22b3-04a7-4225-a646-d9f5a842625a' AND lower(t.ledger_name)=lower(trim(l.ledger)) LIMIT 1),0) as ecy,
  coalesce((SELECT CASE WHEN upper(t.closing_type)='CR' THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END FROM tally_ledgers t WHERE t.engagement_id=(SELECT id FROM pyeng) AND lower(t.ledger_name)=lower(trim(l.ledger)) LIMIT 1),0) as epy,
  (SELECT cr.id FROM crow cr WHERE cr.label=lower(trim(l.ledger)) LIMIT 1) as match
FROM ledgers l
UNION ALL
SELECT 'R', cr.label || ' {' || coalesce(cr.obj->>'section','-') || '/' || coalesce(cr.obj->>'attachedTo','-') || '}',
  coalesce((SELECT (note.cy_data->>(cr.id||'_lt'))::numeric FROM note),0) + coalesce((SELECT (note.cy_data->>(cr.id||'_st'))::numeric FROM note),0) + coalesce((SELECT (note.cy_data->>cr.id)::numeric FROM note),0),
  coalesce((SELECT (note.py_data->>(cr.id||'_lt'))::numeric FROM note),0) + coalesce((SELECT (note.py_data->>(cr.id||'_st'))::numeric FROM note),0) + coalesce((SELECT (note.py_data->>cr.id)::numeric FROM note),0),
  cr.id
FROM crow cr
ORDER BY 1, 2
