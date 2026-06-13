-- SHRI RAM borrowings: every mapped ledger, CY-TB opening vs PY-shell closing,
-- to locate the 1,47,457 gap. Show name as stored in each TB.
WITH cy AS (SELECT id, coa_mapping FROM audit_engagements WHERE id='6074f0fb-679a-4b88-98a6-c421cfcf8e0a'),
py AS (SELECT id FROM audit_engagements WHERE id='49482a0b-d234-4316-ae99-9757da27bc11'),
mapped AS (
  SELECT k AS ledger FROM cy, jsonb_each(cy.coa_mapping) je(k,v) WHERE v->>'code' IN ('NCE_LTB','NCE_STB','BS_NCL_LTB','BS_CL_STB')
)
SELECT m.ledger AS mapping_key,
  tc.ledger_name AS cy_tb_name, tc.opening_balance AS cy_open, tc.opening_type AS cy_open_type,
  tp.ledger_name AS py_tb_name, tp.closing_balance AS py_close, tp.closing_type AS py_close_type
FROM mapped m
LEFT JOIN tally_ledgers tc ON tc.engagement_id=(SELECT id FROM cy) AND lower(trim(tc.ledger_name))=lower(trim(m.ledger))
LEFT JOIN tally_ledgers tp ON tp.engagement_id=(SELECT id FROM py) AND lower(trim(tp.ledger_name))=lower(trim(m.ledger))
WHERE abs(coalesce(tc.opening_balance::numeric,0) - coalesce(tp.closing_balance::numeric,0)) > 1
   OR (tc.ledger_name IS NULL) OR (tp.ledger_name IS NULL)
ORDER BY abs(coalesce(tc.opening_balance::numeric,0) - coalesce(tp.closing_balance::numeric,0)) DESC
