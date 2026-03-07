
-- Fix partner@test.com: update id to match auth user and set firm_id
UPDATE public.users 
SET id = 'd2f15d69-1315-4ecd-954f-62c8c672ebda', 
    firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1'
WHERE email = 'partner@test.com';
