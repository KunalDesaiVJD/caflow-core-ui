CREATE POLICY "Firm delete itr_profiles"
  ON public.itr_profiles
  FOR DELETE
  TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));