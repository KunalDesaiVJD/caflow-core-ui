-- Generic per-note diagnostic: per-ledger expected vs attribution + row list
WITH params AS (
  SELECT 'e11aebd4-6e1e-481c-90dc-7dff556dc5cb'::uuid as eng,
         '49482a0b-d234-4316-ae99-9757da27bc11'::uuid as dummy
),
note AS (
  SELECT n.*, ae.client_id FROM nce_financial_notes n JOIN audit_engagements ae ON ae.id=n.engagement_id
  WHERE n.engagement_id=(SELECT eng FROM params) AND n.note_type='other_income'
),
pyeng AS (
  SELECT id FROM audit_engagements WHERE client_id=(SELECT client_id FROM note) AND financial_year='2024-25' LIMIT 1
),
ledgers AS (
  SELECT je.key as ledger
  FROM audit_engagements ae, jsonb_each(ae.coa_mapping) je
  WHERE ae.id=(SELECT eng FROM params) AND je.value->>'code' IN ('NCE_REV_OTH','PL_REV_OI')
),
crow AS (
  SELECT lower(trim(e->>'label')) as label, e->>'id' as id
  FROM note, jsonb_array_elements(note.cy_data->'_custom_rows') e
  WHERE e->>'id' != 'coa_reconcile_balance'
)
SELECT 'LEDGER' as kind, l.ledger as item,
  coalesce((SELECT CASE WHEN upper(t.closing_type)='CR' THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END FROM tally_ledgers t WHERE t.engagement_id=(SELECT eng FROM params) AND lower(t.ledger_name)=lower(l.ledger) LIMIT 1),0) as ecy,
  coalesce((SELECT CASE WHEN upper(t.closing_type)='CR' THEN abs(t.closing_balance::numeric) ELSE -abs(t.closing_balance::numeric) END FROM tally_ledgers t WHERE t.engagement_id=(SELECT id FROM pyeng) AND lower(t.ledger_name)=lower(l.ledger) LIMIT 1),0) as epy,
  (SELECT cr.id FROM crow cr WHERE cr.label=lower(trim(l.ledger)) LIMIT 1) as row_match
FROM ledgers l
UNION ALL
SELECT 'ROW', cr.label || ' [' || cr.id || ']',
  coalesce((SELECT (note.cy_data->>cr.id)::numeric FROM note),0),
  coalesce((SELECT (note.py_data->>cr.id)::numeric FROM note),0),
  null
FROM crow cr
ORDER BY 1, 2
