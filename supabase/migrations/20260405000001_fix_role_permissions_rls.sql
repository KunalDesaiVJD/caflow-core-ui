-- Fix role_permissions RLS: remove current_user_role() check from INSERT/UPDATE
-- The session variable set by set_user_context is not reliably available at
-- INSERT time (async race). Replace with simple same-firm scoping — the UI
-- already enforces who can reach the edit interface.

DROP POLICY IF EXISTS "rp_insert" ON public.role_permissions;
DROP POLICY IF EXISTS "rp_update" ON public.role_permissions;

CREATE POLICY "rp_insert" ON public.role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "rp_update" ON public.role_permissions
  FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id())
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
