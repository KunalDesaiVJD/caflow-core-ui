-- itr_profiles had only a SELECT policy, so all INSERT/UPDATE/DELETE
-- writes were silently denied by RLS — the IT Returns inline editor
-- (status, prepared_by, checked_by, dates, ack_no, remarks) appeared
-- to do nothing. Add the missing INSERT / UPDATE / DELETE policies,
-- scoped to the user's firm via the same predicate the SELECT policy
-- uses. Superadmins inherit access via the existing pattern.

DROP POLICY IF EXISTS "Firm insert itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Firm update itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Firm delete itr_profiles" ON public.itr_profiles;

CREATE POLICY "Firm insert itr_profiles" ON public.itr_profiles
  FOR INSERT TO authenticated
  WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

CREATE POLICY "Firm update itr_profiles" ON public.itr_profiles
  FOR UPDATE TO authenticated
  USING      (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()))
  WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

CREATE POLICY "Firm delete itr_profiles" ON public.itr_profiles
  FOR DELETE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
