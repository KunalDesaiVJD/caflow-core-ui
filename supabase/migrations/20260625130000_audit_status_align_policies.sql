-- audit_status had a single ALL policy whose predicate used a raw
-- subquery against public.users (SELECT firm_id FROM users WHERE id =
-- auth.uid()).  Whenever the calling user's users-table row was not
-- visible to *itself* under the users-table RLS (a regression that
-- mostly bites staff users created via the user-management dialog),
-- the subquery returned NULL.  PostgreSQL evaluates `firm_id = NULL`
-- to NULL, so PostgREST silently affected zero rows on UPDATE/DELETE
-- and returned no error -- giving the UI a fake "Saved" toast while
-- the change never reached the database.  Refresh wiped the optimistic
-- state and the row reverted to its original values.
--
-- Realign to the same pattern itr_profiles uses (after migration
-- 20260615123000): use current_user_firm_id() / is_superadmin()
-- helpers which are SECURITY DEFINER, so they bypass users-table RLS
-- and always resolve correctly.

DROP POLICY IF EXISTS firm_members_audit_status ON public.audit_status;
DROP POLICY IF EXISTS "Firm select audit_status" ON public.audit_status;
DROP POLICY IF EXISTS "Firm insert audit_status" ON public.audit_status;
DROP POLICY IF EXISTS "Firm update audit_status" ON public.audit_status;
DROP POLICY IF EXISTS "Firm delete audit_status" ON public.audit_status;

CREATE POLICY "Firm select audit_status" ON public.audit_status
  FOR SELECT TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "Firm insert audit_status" ON public.audit_status
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "Firm update audit_status" ON public.audit_status
  FOR UPDATE TO authenticated
  USING      (is_superadmin() OR (firm_id = current_user_firm_id()))
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "Firm delete audit_status" ON public.audit_status
  FOR DELETE TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));
