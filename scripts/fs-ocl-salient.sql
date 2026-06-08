-- For SALIENT INFRATECH: show all TB ledgers mapped to NCE_OCL
-- and all manual rows in the other_cl note
-- to see if manual rows are claiming the TB ledgers

-- TB ledgers mapped to other_cl
SELECT 'TB' AS source, tb.ledger_name, tb.closing_balance, tb.balance_type
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN tally_trial_balance tb ON tb.engagement_id = e.id
WHERE c.name ILIKE '%Salient Infratech%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND e.coa_mapping->tb.ledger_name->>'code' IN ('NCE_OCL','BS_CL_OCL')
  AND ABS(tb.closing_balance) > 0.005
UNION ALL
-- Manual rows in the note
SELECT 'NOTE' AS source, cr->>'label' AS ledger_name, nfn.cy_data->>(cr->>'id') AS closing_balance, 'manual' AS balance_type
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
JOIN nce_financial_notes nfn ON nfn.engagement_id = e.id AND nfn.financial_year = e.financial_year,
LATERAL jsonb_array_elements(COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)) cr
WHERE c.name ILIKE '%Salient Infratech%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND nfn.note_type = 'other_cl'
ORDER BY source, ledger_name;
