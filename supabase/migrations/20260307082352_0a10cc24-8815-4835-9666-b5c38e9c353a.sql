
-- Drop RESTRICTIVE policies on tds_entries and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Firm users can read tds_entries" ON public.tds_entries;
DROP POLICY IF EXISTS "Firm users can insert tds_entries" ON public.tds_entries;
DROP POLICY IF EXISTS "Firm users can update tds_entries" ON public.tds_entries;
DROP POLICY IF EXISTS "Firm users can delete tds_entries" ON public.tds_entries;

CREATE POLICY "Firm users can read tds_entries" ON public.tds_entries
  FOR SELECT TO authenticated USING (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
  );
CREATE POLICY "Firm users can insert tds_entries" ON public.tds_entries
  FOR INSERT TO authenticated WITH CHECK (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
  );
CREATE POLICY "Firm users can update tds_entries" ON public.tds_entries
  FOR UPDATE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()))
  WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "Firm users can delete tds_entries" ON public.tds_entries
  FOR DELETE TO authenticated USING (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
  );

-- Fix clients RESTRICTIVE policies
DROP POLICY IF EXISTS "Users can view clients from their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can insert clients to their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can update clients from their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can delete clients from their firm" ON public.clients;

CREATE POLICY "Users can view clients from their firm" ON public.clients
  FOR SELECT TO authenticated USING (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid()
  );
CREATE POLICY "Users can insert clients to their firm" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid()
  );
CREATE POLICY "Users can update clients from their firm" ON public.clients
  FOR UPDATE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid())
  WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid());
CREATE POLICY "Users can delete clients from their firm" ON public.clients
  FOR DELETE TO authenticated USING (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid()
  );

-- Fix client_profiles RESTRICTIVE policies
DROP POLICY IF EXISTS "Users can read client_profiles from their firm" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can insert client_profiles to their firm" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can update client_profiles from their firm" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can delete client_profiles from their firm" ON public.client_profiles;

CREATE POLICY "Users can read client_profiles from their firm" ON public.client_profiles
  FOR SELECT TO authenticated USING (
    client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid())
  );
CREATE POLICY "Users can insert client_profiles to their firm" ON public.client_profiles
  FOR INSERT TO authenticated WITH CHECK (
    client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid())
  );
CREATE POLICY "Users can update client_profiles from their firm" ON public.client_profiles
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid()))
  WITH CHECK (client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid()));
CREATE POLICY "Users can delete client_profiles from their firm" ON public.client_profiles
  FOR DELETE TO authenticated USING (
    client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid())
  );

-- Fix deductees RESTRICTIVE policies
DROP POLICY IF EXISTS "Firm users can read deductees" ON public.deductees;
DROP POLICY IF EXISTS "Firm users can insert deductees" ON public.deductees;

CREATE POLICY "Firm users can read deductees" ON public.deductees
  FOR SELECT TO authenticated USING (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
  );
CREATE POLICY "Firm users can insert deductees" ON public.deductees
  FOR INSERT TO authenticated WITH CHECK (
    firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
  );

-- Fix users table RESTRICTIVE policies
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Backfill any tds_entries missing firm_id
UPDATE public.tds_entries SET firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1' WHERE firm_id IS NULL;
