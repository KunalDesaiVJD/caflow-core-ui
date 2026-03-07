-- Allow firm users to INSERT itr_profiles
CREATE POLICY "Firm insert itr_profiles"
ON public.itr_profiles
FOR INSERT
TO authenticated
WITH CHECK (
  is_superadmin() OR firm_id = current_user_firm_id()
);

-- Allow firm users to UPDATE itr_profiles
CREATE POLICY "Firm update itr_profiles"
ON public.itr_profiles
FOR UPDATE
TO authenticated
USING (
  is_superadmin() OR firm_id = current_user_firm_id()
);
