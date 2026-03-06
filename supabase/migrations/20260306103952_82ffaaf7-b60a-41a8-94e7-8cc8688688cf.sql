-- Allow authenticated users to read their own row
CREATE POLICY "Users can read own profile"
ON public.users
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Allow authenticated users to update their own row
CREATE POLICY "Users can update own profile"
ON public.users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Fix the superadmin record to match the actual auth user ID
UPDATE public.users
SET id = 'c82493cb-d42c-42a8-bd28-52779f954038'
WHERE id = '3facefb7-69c9-4f66-ab8a-fa9f346c2791';