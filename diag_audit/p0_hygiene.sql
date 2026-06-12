-- Per-engagement hygiene inventory (read-only)
WITH base AS (
  SELECT ae.id, ae.financial_year, c.name, c.entity_type, ae.client_id, ae.coa_mapping
  FROM audit_engagements ae JOIN clients c ON c.id = ae.client_id
),
dupes AS (
  SELECT b.id, count(*) as dup_groups,
         sum(cnt) - count(*) as extra_keys,
         count(*) FILTER (WHERE codes > 1) as conflicting_code_groups
  FROM (
    SELECT b2.id, lower(trim(k)) as norm, count(*) as cnt, count(DISTINCT v->>'code') as codes
    FROM base b2, jsonb_each(coalesce(b2.coa_mapping,'{}'::jsonb)) je(k, v)
    GROUP BY b2.id, lower(trim(k)) HAVING count(*) > 1
  ) d JOIN base b ON b.id = d.id
  GROUP BY b.id
),
plugs AS (
  SELECT n.engagement_id as id, count(*) as plug_notes
  FROM nce_financial_notes n
  WHERE n.cy_data ? 'coa_reconcile_balance' OR n.cy_data ? 'coa_reconcile_balance_lt'
     OR n.py_data ? 'coa_reconcile_balance' OR n.py_data ? 'coa_reconcile_balance_lt'
     OR n.cy_data->'_custom_rows' @> '[{"id":"coa_reconcile_balance"}]'
  GROUP BY n.engagement_id
),
bare AS (
  SELECT n.engagement_id as id, count(*) as bare_keys
  FROM nce_financial_notes n, jsonb_each(n.cy_data) x(k,v)
  WHERE n.note_type IN ('borrowings','provisions','loans_advances','investments')
    AND substring(k,1,1) != '_'
    AND k NOT LIKE '%!_lt' ESCAPE '!' AND k NOT LIKE '%!_st' ESCAPE '!'
    AND jsonb_typeof(v)='number' AND (v)::text::numeric != 0
    AND NOT (n.cy_data ? (k || '_lt')) AND NOT (n.cy_data ? (k || '_st'))
  GROUP BY n.engagement_id
),
strnum AS (
  SELECT n.engagement_id as id, count(*) as string_values
  FROM nce_financial_notes n, jsonb_each(n.cy_data) x(k,v)
  WHERE substring(k,1,1) != '_' AND jsonb_typeof(v) = 'string'
  GROUP BY n.engagement_id
),
unmapped AS (
  SELECT t.engagement_id as id, count(*) as unmapped_with_balance
  FROM tally_ledgers t JOIN base b ON b.id = t.engagement_id
  WHERE abs(coalesce(t.closing_balance::numeric,0)) > 0.005
    AND NOT (coalesce(b.coa_mapping,'{}'::jsonb) ? t.ledger_name)
    AND NOT (coalesce(b.coa_mapping,'{}'::jsonb) ? trim(t.ledger_name))
  GROUP BY t.engagement_id
)
SELECT b.name, b.financial_year, b.id,
  coalesce(d.dup_groups,0) as dup_groups,
  coalesce(d.extra_keys,0) as dup_extra_keys,
  coalesce(d.conflicting_code_groups,0) as dup_conflicting_codes,
  coalesce(p.plug_notes,0) as plug_notes,
  coalesce(br.bare_keys,0) as bare_pattern_a_keys,
  coalesce(s.string_values,0) as string_values,
  coalesce(u.unmapped_with_balance,0) as unmapped_with_balance
FROM base b
LEFT JOIN dupes d ON d.id=b.id
LEFT JOIN plugs p ON p.id=b.id
LEFT JOIN bare br ON br.id=b.id
LEFT JOIN strnum s ON s.id=b.id
LEFT JOIN unmapped u ON u.id=b.id
ORDER BY b.name, b.financial_year
