-- SHRI RAM PRODUCTS: for the disputed PY notes, compute PY THREE ways:
--   (1) COA-page basis  = signed sum of CY-TB OPENING balances (what Stage 6 PY shows)
--   (2) PY-shell basis  = signed sum of PY engagement TB CLOSING (what the Notes were reconciled to)
--   (3) Note stored PY  = sum of py_data numeric values
WITH cy AS (SELECT id, coa_mapping FROM audit_engagements WHERE id='6074f0fb-679a-4b88-98a6-c421cfcf8e0a'),
py AS (SELECT id FROM audit_engagements WHERE id='49482a0b-d234-4316-ae99-9757da27bc11'),
cm(code,note_type,nature) AS (VALUES
  ('NCE_LTB','borrowings','CR'),('NCE_STB','borrowings','CR'),
  ('NCE_TP','trade_payables','CR'),('NCE_OCL','other_cl','CR'),
  ('NCE_TR','trade_receivables','DR'),('NCE_STLA','loans_advances','DR'),('NCE_OCA','other_ca','DR')),
ledg AS (
  SELECT DISTINCT ON (lower(trim(k))) k AS ledger, cm.note_type, cm.nature
  FROM cy, jsonb_each(cy.coa_mapping) je(k,v)
  JOIN cm ON cm.code = v->>'code'
  ORDER BY lower(trim(k)),
    (EXISTS (SELECT 1 FROM tally_ledgers t WHERE t.engagement_id=(SELECT id FROM cy) AND t.ledger_name=k)) DESC, k
)
SELECT l.note_type,
  round(sum(CASE WHEN upper(coalesce(tc.opening_type,''))=l.nature THEN abs(coalesce(tc.opening_balance::numeric,0)) ELSE -abs(coalesce(tc.opening_balance::numeric,0)) END)::numeric,0) AS coa_page_py_opening,
  round(sum(CASE WHEN upper(coalesce(tp.closing_type,''))=l.nature THEN abs(coalesce(tp.closing_balance::numeric,0)) ELSE -abs(coalesce(tp.closing_balance::numeric,0)) END)::numeric,0) AS pyshell_py_closing
FROM ledg l
LEFT JOIN tally_ledgers tc ON tc.engagement_id=(SELECT id FROM cy) AND lower(trim(tc.ledger_name))=lower(trim(l.ledger))
LEFT JOIN tally_ledgers tp ON tp.engagement_id=(SELECT id FROM py) AND lower(trim(tp.ledger_name))=lower(trim(l.ledger))
GROUP BY l.note_type ORDER BY l.note_type
