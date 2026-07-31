SELECT id, name, classification, pan
FROM clients
WHERE name ILIKE '%VINODRAI%' OR name ILIKE '%SAVALIYA%' OR pan = 'ANFPS2934M';
