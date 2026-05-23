-- ─────────────────────────────────────────────────────────────────────────────
-- user_firm_access: superadmin-controlled cross-firm permissions for Billing
-- Allows superadmin to grant any user configurable access (view/create/edit/
-- delete/export) to any firm's Billing data without changing their home firm.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_firm_access (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  firm_id     uuid        NOT NULL REFERENCES public.firms(id)  ON DELETE CASCADE,
  can_view    boolean     NOT NULL DEFAULT true,
  can_create  boolean     NOT NULL DEFAULT false,
  can_edit    boolean     NOT NULL DEFAULT false,
  can_delete  boolean     NOT NULL DEFAULT false,
  can_export  boolean     NOT NULL DEFAULT false,
  granted_by  uuid        REFERENCES public.users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, firm_id)
);

ALTER TABLE public.user_firm_access ENABLE ROW LEVEL SECURITY;

-- Superadmin can do everything
CREATE POLICY "ufa_superadmin" ON public.user_firm_access
  USING  (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- Any authenticated user can read their own grants
CREATE POLICY "ufa_self_read" ON public.user_firm_access
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_superadmin());


-- ── 2. Helper function ────────────────────────────────────────────────────────
-- Returns true if the calling user has been granted a specific permission for
-- the given firm via user_firm_access (cross-firm grant).
CREATE OR REPLACE FUNCTION public.user_firm_can(p_firm_id uuid, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_action
    WHEN 'view'   THEN COALESCE((SELECT can_view   FROM public.user_firm_access WHERE user_id = auth.uid() AND firm_id = p_firm_id LIMIT 1), false)
    WHEN 'create' THEN COALESCE((SELECT can_create FROM public.user_firm_access WHERE user_id = auth.uid() AND firm_id = p_firm_id LIMIT 1), false)
    WHEN 'edit'   THEN COALESCE((SELECT can_edit   FROM public.user_firm_access WHERE user_id = auth.uid() AND firm_id = p_firm_id LIMIT 1), false)
    WHEN 'delete' THEN COALESCE((SELECT can_delete FROM public.user_firm_access WHERE user_id = auth.uid() AND firm_id = p_firm_id LIMIT 1), false)
    WHEN 'export' THEN COALESCE((SELECT can_export FROM public.user_firm_access WHERE user_id = auth.uid() AND firm_id = p_firm_id LIMIT 1), false)
    ELSE false
  END
$$;


-- ── 3. RLS: invoices ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "firm_select_invoices" ON public.invoices;
CREATE POLICY "firm_select_invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'view')
  );

DROP POLICY IF EXISTS "Firm insert invoices" ON public.invoices;
CREATE POLICY "Firm insert invoices" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'create')
  );

DROP POLICY IF EXISTS "Firm update invoices" ON public.invoices;
CREATE POLICY "Firm update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'edit')
  );

DROP POLICY IF EXISTS "Firm delete invoices" ON public.invoices;
CREATE POLICY "Firm delete invoices" ON public.invoices
  FOR DELETE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'delete')
  );


-- ── 4. RLS: billing_receipts ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "firm_select_billing_receipts" ON public.billing_receipts;
CREATE POLICY "firm_select_billing_receipts" ON public.billing_receipts
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'view')
  );

DROP POLICY IF EXISTS "firm_insert_billing_receipts" ON public.billing_receipts;
CREATE POLICY "firm_insert_billing_receipts" ON public.billing_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'create')
  );

DROP POLICY IF EXISTS "firm_update_billing_receipts" ON public.billing_receipts;
CREATE POLICY "firm_update_billing_receipts" ON public.billing_receipts
  FOR UPDATE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'edit')
  );

DROP POLICY IF EXISTS "firm_delete_billing_receipts" ON public.billing_receipts;
CREATE POLICY "firm_delete_billing_receipts" ON public.billing_receipts
  FOR DELETE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'delete')
  );


-- ── 5. RLS: client_billing_opening_balances ───────────────────────────────────
DROP POLICY IF EXISTS "ob_select" ON public.client_billing_opening_balances;
CREATE POLICY "ob_select" ON public.client_billing_opening_balances
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'view')
  );

DROP POLICY IF EXISTS "ob_insert" ON public.client_billing_opening_balances;
CREATE POLICY "ob_insert" ON public.client_billing_opening_balances
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'create')
  );

DROP POLICY IF EXISTS "ob_update" ON public.client_billing_opening_balances;
CREATE POLICY "ob_update" ON public.client_billing_opening_balances
  FOR UPDATE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'edit')
  );

DROP POLICY IF EXISTS "ob_delete" ON public.client_billing_opening_balances;
CREATE POLICY "ob_delete" ON public.client_billing_opening_balances
  FOR DELETE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'delete')
  );


-- ── 6. RLS: billing_kasars ────────────────────────────────────────────────────
-- Drop old ALL-in-one policy, replace with per-operation policies
DROP POLICY IF EXISTS "Firm users can manage kasars" ON public.billing_kasars;

CREATE POLICY "kasars_select" ON public.billing_kasars
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'view')
  );

CREATE POLICY "kasars_insert" ON public.billing_kasars
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'create')
  );

CREATE POLICY "kasars_update" ON public.billing_kasars
  FOR UPDATE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'edit')
  );

CREATE POLICY "kasars_delete" ON public.billing_kasars
  FOR DELETE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'delete')
  );


-- ── 7. RLS: client_ledger_entries ────────────────────────────────────────────
DROP POLICY IF EXISTS "firm_select_ledger_entries" ON public.client_ledger_entries;
CREATE POLICY "firm_select_ledger_entries" ON public.client_ledger_entries
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'view')
  );

DROP POLICY IF EXISTS "firm_insert_ledger_entries" ON public.client_ledger_entries;
CREATE POLICY "firm_insert_ledger_entries" ON public.client_ledger_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'create')
  );

DROP POLICY IF EXISTS "firm_update_ledger_entries" ON public.client_ledger_entries;
CREATE POLICY "firm_update_ledger_entries" ON public.client_ledger_entries
  FOR UPDATE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'edit')
  );

DROP POLICY IF EXISTS "firm_delete_ledger_entries" ON public.client_ledger_entries;
CREATE POLICY "firm_delete_ledger_entries" ON public.client_ledger_entries
  FOR DELETE TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
    OR public.user_firm_can(firm_id, 'delete')
  );


-- ── 8. RLS: clients (SELECT only — for client name lookup in cross-firm ledger)
DROP POLICY IF EXISTS "Client access with superadmin override" ON public.clients;
CREATE POLICY "Client access with superadmin override" ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
    OR user_id = auth.uid()
    OR public.user_firm_can(firm_id, 'view')
  );
