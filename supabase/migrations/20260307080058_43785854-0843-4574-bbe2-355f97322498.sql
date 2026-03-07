
-- Fix existing admin@test.com profile: update id to match auth user and set firm_id
UPDATE public.users 
SET id = 'c6356edd-4b9b-4501-9ba2-1dd1ea12df07', 
    firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1'
WHERE email = 'admin@test.com';
