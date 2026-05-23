-- Find Karan Parekh firm in firms table and its membership_numbers
SELECT id, name, membership_numbers
FROM firms
WHERE name ILIKE '%karan%' OR name ILIKE '%parekh%';
