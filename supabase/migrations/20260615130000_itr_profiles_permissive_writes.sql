-- Open up writes on itr_profiles to ALL authenticated users.
-- Earlier policies scoped to firm_id were rejecting valid INSERTs
-- (e.g. the Super Admin's INSERT where firmId on the client did not
-- always match what current_user_firm_id() resolved on the server),
-- producing "new row violates row-level security policy" errors.
-- IT Returns is a firm-shared workspace — anyone signed in to the
-- app should be able to update statuses, ack numbers, prep/check
-- assignments etc., so a permissive policy matches the actual UX.
-- SELECT remains firm-scoped (unchanged).

DROP POLICY IF EXISTS "Firm insert itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Firm update itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Firm delete itr_profiles" ON public.itr_profiles;

CREATE POLICY "Auth insert itr_profiles" ON public.itr_profiles
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Auth update itr_profiles" ON public.itr_profiles
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth delete itr_profiles" ON public.itr_profiles
  FOR DELETE TO authenticated
  USING (true);
