-- Trace the EXACT auto-populate path for "Web Developing Fees Exp"
-- Check every condition that could skip it

WITH eng AS (
  SELECT e.id AS eid, e.coa_mapping, e.financial_year
  FROM audit_engagements e
  JOIN clients c ON c.id = e.client_id
  WHERE c.name ILIKE '%Shri Ram Products%'
    AND e.financial_year = '2025-26'
    AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  LIMIT 1
),
-- The TB row for Web Developing
webdev_tb AS (
  SELECT tb.*
  FROM eng, tally_trial_balance tb
  WHERE tb.engagement_id = eng.eid
    AND tb.ledger_name = 'Web Developing Fees Exp'
),
-- The note's ejected ledgers
note_ejected AS (
  SELECT COALESCE(nfn.cy_data->'_ejected_ledgers', '[]'::jsonb) AS ejected
  FROM eng
  JOIN nce_financial_notes nfn ON nfn.engagement_id = eng.eid
    AND nfn.financial_year = eng.financial_year
    AND nfn.note_type = 'other_expenses'
),
-- The note's custom rows (manual ones that could claim the ledger)
note_manual AS (
  SELECT cr->>'label' AS label, cr->>'source' AS source
  FROM eng
  JOIN nce_financial_notes nfn ON nfn.engagement_id = eng.eid
    AND nfn.financial_year = eng.financial_year
    AND nfn.note_type = 'other_expenses',
  LATERAL jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr
  WHERE cr->>'source' = 'manual'
)
SELECT
  'Web Developing Fees Exp' AS ledger,
  (SELECT eng.coa_mapping->'Web Developing Fees Exp'->>'code' FROM eng) AS coa_code,
  (SELECT tb.closing_balance FROM webdev_tb tb) AS closing,
  (SELECT tb.balance_type FROM webdev_tb tb) AS bal_type,
  (SELECT jsonb_array_length(ne.ejected) FROM note_ejected ne) AS ejected_count,
  (SELECT ne.ejected @> '"Web Developing Fees Exp"' FROM note_ejected ne) AS is_ejected,
  (SELECT count(*) FROM note_manual) AS manual_row_count,
  (SELECT count(*) FROM note_manual WHERE LOWER(label) = 'web developing fees exp') AS claimed_by_manual,
  -- Check: does the note's _custom_rows contain ANY source that references this ledger?
  (SELECT count(*)
   FROM eng
   JOIN nce_financial_notes nfn ON nfn.engagement_id = eng.eid
     AND nfn.financial_year = eng.financial_year
     AND nfn.note_type = 'other_expenses',
   LATERAL jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr,
   LATERAL jsonb_array_elements(COALESCE(cr->'sources','[]'::jsonb)) src
   WHERE LOWER(src->>'ledger') = 'web developing fees exp'
  ) AS in_any_sources;
