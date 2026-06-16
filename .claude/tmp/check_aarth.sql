-- Pull every itr_profiles row for AARTH INDUSTRIES so we can see what
-- the refetch is actually returning to the UI.
SELECT p.id, p.client_id, p.firm_id, p.assessment_year, p.financial_year,
       p.filing_status, p.prepared_by, p.checked_by,
       u_p.name AS prepared_by_name, u_c.name AS checked_by_name
FROM itr_profiles p
LEFT JOIN users u_p ON u_p.id = p.prepared_by
LEFT JOIN users u_c ON u_c.id = p.checked_by
JOIN clients c ON c.id = p.client_id
WHERE c.name ILIKE 'AARTH%'
ORDER BY p.assessment_year, p.id;
