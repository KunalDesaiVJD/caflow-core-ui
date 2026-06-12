-- For each remaining plug note: note sum (sans plug), deduped COA sum, plug
-- value, and counts of unmatched rows — to see WHY the assertion fails.
WITH cmap(code, note_type) AS (
  VALUES ('NCE_LTB','borrowings'),('NCE_STB','borrowings'),('BS_NCL_LTB','borrowings'),('BS_CL_STB','borrowings'),
         ('NCE_TP','trade_payables'),('BS_CL_TP','trade_payables'),('BS_CL_TP_MSME','trade_payables'),('BS_CL_TP_OTH','trade_payables'),
         ('NCE_OCL','other_cl'),('BS_CL_OCL','other_cl'),
         ('NCE_TR','trade_receivables'),('BS_CA_TR','trade_receivables')
),
nature(note_type, nat) AS (
  VALUES ('borrowings','CR'),('trade_payables','CR'),('other_cl','CR'),('trade_receivables','DR')
),
targets AS (
  SELECT n.id, n.engagement_id, n.note_type, n.cy_data, n.py_data, c.name, ae.client_id
  FROM nce_financial_notes n
  JOIN audit_engagements ae ON ae.id = n.engagement_id
  JOIN clients c ON c.id = ae.client_id
  WHERE n.cy_data ? 'coa_reconcile_balance' OR n.cy_data ? 'coa_reconcile_balance_lt'
     OR n.py_data ? 'coa_reconcile_balance' OR n.py_data ? 'coa_reconcile_balance_lt'
),
pyeng AS (
  SELECT t.id as note_id, ae.id as py_id
  FROM targets t LEFT JOIN audit_engagements ae
    ON ae.client_id = t.client_id AND ae.financial_year = '2024-25'
),
coa AS (
  SELECT t.id as note_id,
    sum(coalesce((SELECT CASE WHEN upper(tt.closing_type)=(SELECT nat FROM nature WHERE note_type=t.note_type)
                              THEN abs(tt.closing_balance::numeric) ELSE -abs(tt.closing_balance::numeric) END
                  FROM tally_ledgers tt WHERE tt.engagement_id=t.engagement_id
                    AND lower(tt.ledger_name)=lower(trim(lg.ledger)) LIMIT 1),0)) as coa_cy,
    sum(coalesce((SELECT CASE WHEN upper(tt.closing_type)=(SELECT nat FROM nature WHERE note_type=t.note_type)
                              THEN abs(tt.closing_balance::numeric) ELSE -abs(tt.closing_balance::numeric) END
                  FROM tally_ledgers tt WHERE tt.engagement_id=(SELECT py_id FROM pyeng WHERE note_id=t.id)
                    AND lower(tt.ledger_name)=lower(trim(lg.ledger)) LIMIT 1),0)) as coa_py
  FROM targets t
  CROSS JOIN LATERAL (
    SELECT DISTINCT ON (lower(trim(je.key))) je.key AS ledger
    FROM audit_engagements ae2, jsonb_each(ae2.coa_mapping) je
    WHERE ae2.id = t.engagement_id
      AND je.value->>'code' IN (SELECT code FROM cmap WHERE note_type = t.note_type)
    ORDER BY lower(trim(je.key)), je.key
  ) lg
  GROUP BY t.id
),
sums AS (
  SELECT t.id as note_id,
    (SELECT coalesce(sum((v)::numeric),0) FROM jsonb_each_text(t.cy_data) x(k,v)
     WHERE substring(k,1,1)<>'_' AND k NOT LIKE 'coa_reconcile%' AND v ~ '^-?[0-9]') as note_cy,
    (SELECT coalesce(sum((v)::numeric),0) FROM jsonb_each_text(t.py_data) x(k,v)
     WHERE substring(k,1,1)<>'_' AND k NOT LIKE 'coa_reconcile%' AND v ~ '^-?[0-9]') as note_py
  FROM targets t
)
SELECT t.name, t.note_type,
  round(s.note_cy,0) as note_cy, round(c.coa_cy,0) as coa_cy, round((s.note_cy-c.coa_cy),0) as gap_cy,
  round(s.note_py,0) as note_py, round(c.coa_py,0) as coa_py, round((s.note_py-c.coa_py),0) as gap_py
FROM targets t JOIN coa c ON c.note_id=t.id JOIN sums s ON s.note_id=t.id
ORDER BY t.name, t.note_type
