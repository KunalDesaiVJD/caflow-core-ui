-- Inspect the current_user_firm_id() helper and Soumil's mapping
SELECT pg_get_functiondef(oid) AS def
FROM pg_proc WHERE proname = 'current_user_firm_id';

SELECT id, name, email, role, firm_id, auth_user_id
FROM users
WHERE email ILIKE '%soumil%' OR name ILIKE '%soumil%';
