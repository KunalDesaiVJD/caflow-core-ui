SELECT count(*) AS policy_count FROM pg_policies WHERE tablename = 'audit_status';

SELECT policyname, cmd FROM pg_policies WHERE tablename = 'audit_status';

-- Sample row to confirm data exists
SELECT id, party_name, physical_audit_conducted, accounting_data
FROM audit_status
WHERE party_name ILIKE 'OM REALTY%'
LIMIT 3;
