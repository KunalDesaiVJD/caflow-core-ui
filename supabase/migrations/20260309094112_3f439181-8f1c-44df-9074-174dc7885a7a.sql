-- Add permissive policies for firms table so superadmin and firm_admin can update
CREATE POLICY "Firm admins and superadmin can select firms"
ON public.firms
FOR SELECT
TO authenticated
USING (is_superadmin() OR id = current_user_firm_id());

CREATE POLICY "Firm admins and superadmin can update firms"
ON public.firms
FOR UPDATE
TO authenticated
USING (is_superadmin() OR id = current_user_firm_id())
WITH CHECK (is_superadmin() OR id = current_user_firm_id());