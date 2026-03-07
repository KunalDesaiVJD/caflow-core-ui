-- Prevent RLS recursion on public.users and restore superadmin access

-- Helper functions (SECURITY DEFINER avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.current_user_firm_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT firm_id FROM public.users WHERE id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'superadmin' FROM public.users WHERE id = auth.uid() LIMIT 1), false)
$$;

-- USERS: drop recursive policy and replace with non-recursive policies
DROP POLICY IF EXISTS "Users can read firm members" ON public.users;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

CREATE POLICY "Users can read own profile"
ON public.users
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Firm admins can read firm users"
ON public.users
FOR SELECT
TO authenticated
USING (
  public.current_user_role() IN ('firm_admin', 'superadmin')
  AND (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
  )
);

CREATE POLICY "Users can update own profile"
ON public.users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Allow superadmin reads across key firm-scoped tables used by dashboard/app
DROP POLICY IF EXISTS "Firm users can select clients" ON public.clients;
CREATE POLICY "Firm users can select clients"
ON public.clients
FOR SELECT
TO authenticated
USING (
  public.is_superadmin()
  OR firm_id = public.current_user_firm_id()
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "Firm select tds_entries" ON public.tds_entries;
CREATE POLICY "Firm select tds_entries"
ON public.tds_entries
FOR SELECT
TO authenticated
USING (
  public.is_superadmin()
  OR firm_id = public.current_user_firm_id()
);

DROP POLICY IF EXISTS "Firm select deductees" ON public.deductees;
CREATE POLICY "Firm select deductees"
ON public.deductees
FOR SELECT
TO authenticated
USING (
  public.is_superadmin()
  OR firm_id = public.current_user_firm_id()
);

DROP POLICY IF EXISTS "Firm select client_profiles" ON public.client_profiles;
CREATE POLICY "Firm select client_profiles"
ON public.client_profiles
FOR SELECT
TO authenticated
USING (
  public.is_superadmin()
  OR client_id IN (
    SELECT c.id
    FROM public.clients c
    WHERE public.is_superadmin()
      OR c.firm_id = public.current_user_firm_id()
      OR c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Firm select itr_profiles" ON public.itr_profiles;
CREATE POLICY "Firm select itr_profiles"
ON public.itr_profiles
FOR SELECT
TO authenticated
USING (
  public.is_superadmin()
  OR firm_id = public.current_user_firm_id()
);

DROP POLICY IF EXISTS "Firm select audit_engagements" ON public.audit_engagements;
CREATE POLICY "Firm select audit_engagements"
ON public.audit_engagements
FOR SELECT
TO authenticated
USING (
  public.is_superadmin()
  OR firm_id = public.current_user_firm_id()
);
