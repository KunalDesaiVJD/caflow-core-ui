-- Step 1: Find the auth user
SELECT id AS auth_user_id, email, created_at
FROM auth.users
WHERE email ILIKE 'chitragupt_80@yahoo.com';

-- Step 2: Find all clients with this email
SELECT id, name, email, user_id, is_active, deleted_at, is_draft, firm_id
FROM public.clients
WHERE email ILIKE 'chitragupt_80@yahoo.com'
ORDER BY name;

-- Step 3: Find all clients where user_id links to this auth user
SELECT c.id, c.name, c.email, c.user_id, c.is_active
FROM public.clients c
JOIN auth.users u ON u.id = c.user_id
WHERE u.email ILIKE 'chitragupt_80@yahoo.com';

-- Step 4: Count of clients per firm (to find what firm these belong to)
SELECT firm_id, count(*) as total_clients
FROM public.clients
WHERE is_active IS NOT FALSE AND deleted_at IS NULL
GROUP BY firm_id
ORDER BY total_clients DESC
LIMIT 5;

-- Step 5: What emails are in the clients table for firm of VJ Desai
SELECT id, name, email, user_id, mobile
FROM public.clients
WHERE name ILIKE '%ACS%'
LIMIT 10;
