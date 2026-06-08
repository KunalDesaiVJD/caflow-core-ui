-- Check: how many ledgers are in the COA mapping for SHRI RAM?
-- If the hash hasn't changed since last sync, the auto-sync skips.
SELECT
  jsonb_object_keys_count(e.coa_mapping) AS coa_entry_count,
  e.updated_at AS engagement_updated
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
WHERE c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false);
