SELECT id, name, email, role, firm_id
FROM users
WHERE role ILIKE '%admin%' OR email ILIKE '%jaybhanderi%';
