SELECT c.id, c.name, c.classification AS clients_col
FROM clients c
WHERE c.name ILIKE '%VINOD%SAVAL%';

SELECT cfc.client_id, c.name, cfc.financial_year, cfc.classification
FROM client_fy_classifications cfc
LEFT JOIN clients c ON c.id = cfc.client_id
WHERE c.name ILIKE '%VINOD%SAVAL%'
ORDER BY cfc.financial_year DESC;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'client_classification_history';
