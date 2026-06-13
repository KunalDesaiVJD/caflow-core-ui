-- MAHIL other_cl: find the ledger(s) whose mapping key is DUPLICATED with a
-- conflicting code, so the panel anchor (exact TB-name lookup) attributes it
-- to a different note than the note auto-populate did. Show every OCL-mapped
-- key, its PY-shell closing, and whether a case-variant maps to another code.
WITH cy AS (SELECT id, coa_mapping FROM audit_engagements WHERE id='e11aebd4-6e1e-481c-90dc-7dff556dc5cb'),
py AS (SELECT id FROM audit_engagements WHERE client_id=(SELECT client_id FROM audit_engagements WHERE id='e11aebd4-6e1e-481c-90dc-7dff556dc5cb') AND financial_year='2024-25' LIMIT 1),
allmap AS (SELECT k, v->>'code' AS code FROM cy, jsonb_each(cy.coa_mapping) je(k,v)),
ocl AS (SELECT k FROM allmap WHERE code IN ('NCE_OCL','BS_CL_OCL'))
SELECT o.k AS ocl_key,
  (SELECT string_agg(DISTINCT a.code, ' | ') FROM allmap a WHERE lower(trim(a.k))=lower(trim(o.k))) AS all_codes_for_this_name,
  (SELECT count(*) FROM allmap a WHERE lower(trim(a.k))=lower(trim(o.k))) AS variants,
  tp.closing_balance AS py_close, tp.closing_type AS py_type,
  (SELECT t.ledger_name FROM tally_ledgers t WHERE t.engagement_id=(SELECT id FROM cy) AND lower(trim(t.ledger_name))=lower(trim(o.k)) LIMIT 1) AS cy_tb_exact_name
FROM ocl o
LEFT JOIN tally_ledgers tp ON tp.engagement_id=(SELECT id FROM py) AND lower(trim(tp.ledger_name))=lower(trim(o.k))
WHERE (SELECT count(*) FROM allmap a WHERE lower(trim(a.k))=lower(trim(o.k))) > 1
   OR abs(coalesce(tp.closing_balance::numeric,0)) BETWEEN 42000 AND 43000
ORDER BY 3 DESC
