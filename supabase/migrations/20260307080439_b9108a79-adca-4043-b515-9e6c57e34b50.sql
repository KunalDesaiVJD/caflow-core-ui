
-- Fix all user profiles: sync IDs with auth.users and set firm_id
UPDATE public.users SET id = '51f7f47b-0977-4121-abd7-03416b366fa8', firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1' WHERE email = 'manager@test.com';
UPDATE public.users SET id = 'f61230c0-adfd-4b88-ad27-7a8f38eba7d5', firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1' WHERE email = 'staff@test.com';
UPDATE public.users SET id = 'b2fe6920-abe3-444c-bb8d-245fd4017c3b', firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1' WHERE email = 'article@test.com';
UPDATE public.users SET id = '0eab2860-5e22-4b30-a12b-75384505c825', firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1' WHERE email = 'client@test.com';
