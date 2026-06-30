-- Confirm latest policies are in place
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'audit_status' ORDER BY cmd;

-- Show current state of SWASTIK rows
SELECT id, party_name, physical_audit_conducted, accounting_data, firm_id, financial_year
FROM audit_status
WHERE party_name ILIKE 'SWASTIK%'
ORDER BY party_name;
