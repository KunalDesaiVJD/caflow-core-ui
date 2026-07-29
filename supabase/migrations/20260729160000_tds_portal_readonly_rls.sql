-- ═══════════════════════════════════════════════════════════════════════════
-- TDS × Client Portal — per-client read-only isolation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BACKGROUND (this is a live hole, not a hypothetical):
--   Client-portal logins are rows in public.users with role = 'client' AND
--   firm_id = the CA firm's id (set by supabase/functions/user-management).
--   Every TDS table is guarded only by `firm_id = current_user_firm_id()`,
--   with no role check. current_user_firm_id() therefore returns the CA firm
--   for a portal user, so ANY logged-in client can already read EVERY client's
--   TDS data in that firm through the REST API — and on tds_deductees,
--   tds_challans and tds_pan_verification_results the policy is FOR ALL, so
--   they can write it too. No UI exposes this today, which is the only reason
--   it has not been hit.
--
-- WHAT THIS MIGRATION DOES:
--   1. portal_client_ids() — the set of client ids the calling portal user
--      legitimately owns (user_id link OR shared-email link), mirroring the
--      existing get_portal_clients_by_email() lookup.
--   2. A blanket RESTRICTIVE "no client-role access" policy on every TDS
--      table. RESTRICTIVE policies are AND-ed with the permissive ones, so
--      this closes the hole against every existing AND future permissive
--      policy without having to rewrite any of them.
--   3. On the three tables the portal's read-only Data Entry view needs
--      (tds_filings, tds_challans, tds_deductees): per-command RESTRICTIVE
--      policies that allow a client SELECT of their OWN rows only, and block
--      INSERT / UPDATE / DELETE outright, plus an explicit permissive SELECT
--      so portal reads do not depend on the portal user's firm_id being set.
--
-- Staff roles are entirely unaffected: every new policy short-circuits on
-- `current_user_role() IS DISTINCT FROM 'client'`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which clients does the calling portal user own? ──────────────────────
-- SECURITY DEFINER so it can read auth.users.email — auth.jwt() ->> 'email'
-- is not reliably present in policy context (same reason
-- get_portal_clients_by_email() exists).
CREATE OR REPLACE FUNCTION public.portal_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.clients c
  WHERE c.deleted_at IS NULL
    AND c.is_active IS NOT FALSE
    AND (
      c.user_id = auth.uid()
      OR (
        c.email IS NOT NULL
        AND lower(c.email) = lower(
          (SELECT au.email FROM auth.users au WHERE au.id = auth.uid())
        )
      )
    )
$$;

GRANT EXECUTE ON FUNCTION public.portal_client_ids() TO authenticated;

-- ── 2. Blanket: no client-role access to any TDS table ──────────────────────
-- Covers every TDS table EXCEPT the three the portal reads — those get the
-- narrower per-command treatment in section 3 instead.
DO $$
DECLARE
  t text;
  tables_all text[] := ARRAY[
    'tds_entries', 'tds_ack_files', 'tds_demand_items', 'tds_filing_audit_log',
    'tds_import_batches', 'tds_imported_rows', 'tds_pan_verification_batches',
    'tds_pan_verification_results', 'tds_pan_verification_rows',
    'tds_rate_master', 'tds_rate_master_audit_log', 'tds_recon_flags',
    'tds_recon_results', 'tds_section_aliases', 'tds_tally_batches',
    'tds_tally_party_maps', 'tds_tally_results', 'tds_tally_rows',
    'tds_tb_party_mappings'
  ];
BEGIN
  FOREACH t IN ARRAY tables_all LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_no_portal_client_access', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING (public.current_user_role() IS DISTINCT FROM ''client'') '
        'WITH CHECK (public.current_user_role() IS DISTINCT FROM ''client'')',
        'tds_no_portal_client_access', t
      );
    END IF;
  END LOOP;
END $$;

-- ── 3. Portal-readable tables: own rows, SELECT only ────────────────────────
-- NOTE: these must be per-command, NOT `FOR ALL`. A restrictive FOR ALL
-- policy also applies to SELECT, and restrictive policies are AND-ed — a
-- blanket "not a client" rule would cancel out the read grant below.
DO $$
DECLARE
  t text;
  tables_portal text[] := ARRAY['tds_filings', 'tds_challans', 'tds_deductees'];
BEGIN
  FOREACH t IN ARRAY tables_portal LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 3a. RESTRICTIVE SELECT — a client may only ever see their own rows.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_portal_select_own_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated '
      'USING ('
      '  public.current_user_role() IS DISTINCT FROM ''client'''
      '  OR client_id IN (SELECT public.portal_client_ids())'
      ')',
      'tds_portal_select_own_only', t
    );

    -- 3b. RESTRICTIVE writes — a client may never insert/update/delete.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_portal_no_client_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated '
      'WITH CHECK (public.current_user_role() IS DISTINCT FROM ''client'')',
      'tds_portal_no_client_insert', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_portal_no_client_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated '
      'USING (public.current_user_role() IS DISTINCT FROM ''client'') '
      'WITH CHECK (public.current_user_role() IS DISTINCT FROM ''client'')',
      'tds_portal_no_client_update', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_portal_no_client_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated '
      'USING (public.current_user_role() IS DISTINCT FROM ''client'')',
      'tds_portal_no_client_delete', t
    );

    -- 3c. PERMISSIVE SELECT for the portal. The existing firm_scope_select
    -- policy happens to match portal users too (their users.firm_id is the CA
    -- firm's), but relying on that would break the portal the day a client
    -- user is provisioned without a firm_id. This grants the read explicitly;
    -- 3a still narrows it to their own client ids.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_portal_read_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (client_id IN (SELECT public.portal_client_ids()))',
      'tds_portal_read_own', t
    );
  END LOOP;
END $$;
