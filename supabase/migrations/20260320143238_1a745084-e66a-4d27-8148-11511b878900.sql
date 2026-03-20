-- Make client/work groups global and allow superadmin client CRUD visibility

ALTER TABLE public.client_groups ALTER COLUMN firm_id DROP NOT NULL;
ALTER TABLE public.work_groups ALTER COLUMN firm_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users can view work groups in their firm" ON public.work_groups;
DROP POLICY IF EXISTS "Users can insert work groups in their firm" ON public.work_groups;
DROP POLICY IF EXISTS "Users can update work groups in their firm" ON public.work_groups;
DROP POLICY IF EXISTS "Users can delete work groups in their firm" ON public.work_groups;

CREATE POLICY "Authenticated users can view work groups"
ON public.work_groups
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert work groups"
ON public.work_groups
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update work groups"
ON public.work_groups
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete work groups"
ON public.work_groups
FOR DELETE
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can view work group memberships" ON public.work_group_memberships;
DROP POLICY IF EXISTS "Users can manage work group memberships" ON public.work_group_memberships;
DROP POLICY IF EXISTS "Users can delete work group memberships" ON public.work_group_memberships;

CREATE POLICY "Authenticated users can view work group memberships"
ON public.work_group_memberships
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert work group memberships"
ON public.work_group_memberships
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete work group memberships"
ON public.work_group_memberships
FOR DELETE
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Firm users can select clients" ON public.clients;
DROP POLICY IF EXISTS "Firm users can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Firm users can update clients" ON public.clients;
DROP POLICY IF EXISTS "Firm users can delete clients" ON public.clients;
DROP POLICY IF EXISTS "Users can view clients from their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can insert clients to their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can update clients from their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can delete clients from their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can insert clients for their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can read clients for their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can update clients for their firm" ON public.clients;

CREATE POLICY "Client access with superadmin override"
ON public.clients
FOR SELECT
TO authenticated
USING (
  is_superadmin()
  OR firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
  OR user_id = auth.uid()
);

CREATE POLICY "Client insert with superadmin override"
ON public.clients
FOR INSERT
TO authenticated
WITH CHECK (
  is_superadmin()
  OR firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
  OR user_id = auth.uid()
);

CREATE POLICY "Client update with superadmin override"
ON public.clients
FOR UPDATE
TO authenticated
USING (
  is_superadmin()
  OR firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
  OR user_id = auth.uid()
)
WITH CHECK (
  is_superadmin()
  OR firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
  OR user_id = auth.uid()
);

CREATE POLICY "Client delete with superadmin override"
ON public.clients
FOR DELETE
TO authenticated
USING (
  is_superadmin()
  OR firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
  OR user_id = auth.uid()
);