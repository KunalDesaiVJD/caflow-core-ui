-- Fix client_groups RLS to allow global groups (firm_id IS NULL) to be visible to all
DROP POLICY IF EXISTS firm_scope_select ON public.client_groups;
CREATE POLICY firm_scope_select ON public.client_groups
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id IS NULL OR firm_id = current_user_firm_id());

DROP POLICY IF EXISTS firm_scope_update ON public.client_groups;
CREATE POLICY firm_scope_update ON public.client_groups
  FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id IS NULL OR firm_id = current_user_firm_id());

DROP POLICY IF EXISTS firm_scope_delete ON public.client_groups;
CREATE POLICY firm_scope_delete ON public.client_groups
  FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id IS NULL OR firm_id = current_user_firm_id());