SELECT id, party_name, financial_year, physical_audit_conducted, accounting_data, firm_id, created_at
FROM audit_status
WHERE party_name ILIKE '%SWASTIK%' OR party_name ILIKE '%BUILDCON%'
ORDER BY created_at DESC NULLS LAST;
