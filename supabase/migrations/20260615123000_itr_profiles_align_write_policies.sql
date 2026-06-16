-- Align itr_profiles write policies with the SELECT policy's predicate.
-- The SELECT policy uses helper functions (is_superadmin() and
-- current_user_firm_id()) that resolve correctly even for staff users
-- whose users.id does not equal auth.uid(). The earlier write policies
-- used a raw subquery against users.id = auth.uid() which returns no
-- rows for those staff accounts, so writes were still silently denied.

DROP POLICY IF EXISTS "Firm insert itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Firm update itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Firm delete itr_profiles" ON public.itr_profiles;

CREATE POLICY "Firm insert itr_profiles" ON public.itr_profiles
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "Firm update itr_profiles" ON public.itr_profiles
  FOR UPDATE TO authenticated
  USING      (is_superadmin() OR (firm_id = current_user_firm_id()))
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "Firm delete itr_profiles" ON public.itr_profiles
  FOR DELETE TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));
