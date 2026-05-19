-- Allow all authenticated users to read the firms list.
-- The previous policy restricted non-superadmins to their own firm,
-- which prevented the billing module firm dropdown from showing co-firms
-- (K Desai & Associates, Dixita Desai, etc.) for firm-level users.
-- Mutation operations (INSERT/UPDATE/DELETE) remain restricted.

DROP POLICY IF EXISTS "Firm admins and superadmin can select firms" ON public.firms;

CREATE POLICY "All authenticated users can read firms"
  ON public.firms
  FOR SELECT
  TO authenticated
  USING (true);
