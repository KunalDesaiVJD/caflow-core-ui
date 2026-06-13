-- MAHIL Other Current Liabilities: PY by opening-basis vs PY-shell-basis,
-- and whether any duplicate/case-mismatch ledger explains the 42,468 gap.
WITH cy AS (SELECT id, coa_mapping FROM audit_engagements WHERE id='e11aebd4-6e1e-481c-90dc-7dff556dc5cb'),
py AS (SELECT id FROM audit_engagements WHERE client_id=(SELECT client_id FROM audit_engagements WHERE id='e11aebd4-6e1e-481c-90dc-7dff556dc5cb') AND financial_year='2024-25' LIMIT 1),
ledg AS (
  SELECT DISTINCT ON (lower(trim(k))) k AS ledger
  FROM cy, jsonb_each(cy.coa_mapping) je(k,v)
  WHERE v->>'code' IN ('NCE_OCL','BS_CL_OCL')
  ORDER BY lower(trim(k)),
    (EXISTS (SELECT 1 FROM tally_ledgers t WHERE t.engagement_id=(SELECT id FROM cy) AND t.ledger_name=k)) DESC, k
)
SELECT
  round(sum(CASE WHEN upper(coalesce(tc.opening_type,''))='CR' THEN abs(coalesce(tc.opening_balance::numeric,0)) ELSE -abs(coalesce(tc.opening_balance::numeric,0)) END)::numeric,0) AS coa_page_py_opening,
  round(sum(CASE WHEN upper(coalesce(tp.closing_type,''))='CR' THEN abs(coalesce(tp.closing_balance::numeric,0)) ELSE -abs(coalesce(tp.closing_balance::numeric,0)) END)::numeric,0) AS pyshell_py_closing
FROM ledg l
LEFT JOIN tally_ledgers tc ON tc.engagement_id=(SELECT id FROM cy) AND lower(trim(tc.ledger_name))=lower(trim(l.ledger))
LEFT JOIN tally_ledgers tp ON tp.engagement_id=(SELECT id FROM py) AND lower(trim(tp.ledger_name))=lower(trim(l.ledger))
