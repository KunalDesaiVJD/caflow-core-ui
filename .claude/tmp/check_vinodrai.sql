SELECT c.id, c.name, c.classification AS clients_col
FROM clients c
WHERE c.name ILIKE '%VINOD%SAVAL%' OR c.name ILIKE '%SAVAL%';

SELECT cfc.client_id, c.name, cfc.financial_year, cfc.classification
FROM client_fy_classifications cfc
LEFT JOIN clients c ON c.id = cfc.client_id
WHERE c.name ILIKE '%VINOD%SAVAL%'
ORDER BY cfc.financial_year DESC;

SELECT cch.client_id, c.name, cch.effective_from_fy, cch.classification,
       cch.previous_classification, cch.old_classification, cch.created_at
FROM client_classification_history cch
LEFT JOIN clients c ON c.id = cch.client_id
WHERE c.name ILIKE '%VINOD%SAVAL%'
ORDER BY cch.created_at DESC;
