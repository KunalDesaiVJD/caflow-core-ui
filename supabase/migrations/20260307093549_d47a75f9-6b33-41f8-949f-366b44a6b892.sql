
-- Fix all RESTRICTIVE RLS policies to PERMISSIVE for clients, tds_entries, deductees, client_profiles

-- ===== CLIENTS =====
DROP POLICY IF EXISTS "Users can view clients from their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can insert clients to their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can update clients from their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can delete clients from their firm" ON public.clients;

CREATE POLICY "Firm users can select clients" ON public.clients FOR SELECT TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid());
CREATE POLICY "Firm users can insert clients" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid());
CREATE POLICY "Firm users can update clients" ON public.clients FOR UPDATE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid());
CREATE POLICY "Firm users can delete clients" ON public.clients FOR DELETE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR user_id = auth.uid());

-- ===== TDS_ENTRIES =====
DROP POLICY IF EXISTS "Firm users can read tds_entries" ON public.tds_entries;
DROP POLICY IF EXISTS "Firm users can insert tds_entries" ON public.tds_entries;
DROP POLICY IF EXISTS "Firm users can update tds_entries" ON public.tds_entries;
DROP POLICY IF EXISTS "Firm users can delete tds_entries" ON public.tds_entries;

CREATE POLICY "Firm select tds_entries" ON public.tds_entries FOR SELECT TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "Firm insert tds_entries" ON public.tds_entries FOR INSERT TO authenticated
  WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "Firm update tds_entries" ON public.tds_entries FOR UPDATE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "Firm delete tds_entries" ON public.tds_entries FOR DELETE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

-- ===== DEDUCTEES =====
DROP POLICY IF EXISTS "Firm users can read deductees" ON public.deductees;
DROP POLICY IF EXISTS "Firm users can insert deductees" ON public.deductees;

CREATE POLICY "Firm select deductees" ON public.deductees FOR SELECT TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "Firm insert deductees" ON public.deductees FOR INSERT TO authenticated
  WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "Firm update deductees" ON public.deductees FOR UPDATE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
CREATE POLICY "Firm delete deductees" ON public.deductees FOR DELETE TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

-- ===== CLIENT_PROFILES =====
DROP POLICY IF EXISTS "Users can read client_profiles from their firm" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can insert client_profiles to their firm" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can update client_profiles from their firm" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can delete client_profiles from their firm" ON public.client_profiles;

CREATE POLICY "Firm select client_profiles" ON public.client_profiles FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid()));
CREATE POLICY "Firm insert client_profiles" ON public.client_profiles FOR INSERT TO authenticated
  WITH CHECK (client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid()));
CREATE POLICY "Firm update client_profiles" ON public.client_profiles FOR UPDATE TO authenticated
  USING (client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid()));
CREATE POLICY "Firm delete client_profiles" ON public.client_profiles FOR DELETE TO authenticated
  USING (client_id IN (SELECT c.id FROM clients c WHERE c.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()) OR c.user_id = auth.uid()));

-- ===== USERS - fix restrictive to permissive =====
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

CREATE POLICY "Users can read own profile" ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Also allow users to read firm members (needed for firm_id lookups in RLS subqueries)
CREATE POLICY "Users can read firm members" ON public.users FOR SELECT TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

-- ===== VERSION_HISTORY (for activity feed) =====
ALTER TABLE public.version_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Firm users can read version_history" ON public.version_history FOR SELECT TO authenticated
  USING (true);

-- ===== ITR_PROFILES =====
ALTER TABLE public.itr_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Firm select itr_profiles" ON public.itr_profiles FOR SELECT TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

-- ===== AUDIT_ENGAGEMENTS =====
ALTER TABLE public.audit_engagements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Firm select audit_engagements" ON public.audit_engagements FOR SELECT TO authenticated
  USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
