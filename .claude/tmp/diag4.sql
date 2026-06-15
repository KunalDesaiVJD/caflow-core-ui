SELECT n.nspname AS schema, p.proname AS name, pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('current_user_firm_id', 'is_superadmin');
