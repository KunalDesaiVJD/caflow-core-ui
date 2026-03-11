-- Allow all authenticated users to read basic info of their firm colleagues (needed for chat)
CREATE POLICY "Same firm users can read colleagues"
ON public.users
FOR SELECT
TO authenticated
USING (firm_id = current_user_firm_id());