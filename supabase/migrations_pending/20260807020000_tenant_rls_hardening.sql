-- ─────────────────────────────────────────────────────────────────────────
-- Tenant RLS hardening (enterprise security audit, 2026-08).
--
-- This migration is purely additive/corrective to RLS POLICIES — it does not
-- drop any table, column, or row, and does not touch historical migration
-- files. Every change below replaces a `USING (true)` / anon-writable policy
-- with a firm-scoped (or, for `documents`, client-scoped) predicate using the
-- same `is_superadmin()` / `current_user_firm_id()` helper functions already
-- used correctly elsewhere in this schema (see 20260307094410_*.sql).
--
-- REQUIRES CAREFUL ROLLOUT — read before applying to production:
--   1. tally_groups / tally_ledgers / tally_trial_balance / tally_vouchers /
--      sync_batches / engagements were previously readable+writable by the
--      `anon` role (i.e. unauthenticated) and by every authenticated user of
--      every firm. This migration revokes `anon` entirely and scopes
--      authenticated access to the caller's own firm via a join through
--      audit_engagements.firm_id (these tables key off engagement_id, they
--      have no firm_id column of their own). If any legitimate flow relies
--      on anonymous or cross-firm access to these tables (e.g. a service
--      that calls Postgres directly with the anon key instead of a signed-in
--      session, or the local Tally-sync desktop agent using the anon key),
--      that flow will start failing until it's updated to use an
--      authenticated session or the service_role key instead.
--   2. itr_profiles: a firm-scoped write policy was tried once already
--      (20260615123000_*.sql) and was REVERTED one migration later
--      (20260615130000_*.sql) because it was rejecting legitimate superadmin
--      inserts in some cases the team did not fully root-cause. This
--      migration reinstates firm-scoping (matching the audit's recommended
--      fix — the alternative is to leave every tenant's IT-return data
--      writable by every other tenant, which is worse). TEST THIS
--      SPECIFICALLY as both a superadmin and a regular firm_admin/staff user
--      before/after applying, since the prior revert suggests there may be
--      an edge case in how current_user_firm_id()/is_superadmin() resolve
--      for some account shapes that hasn't been fully diagnosed.
--   3. documents / firm-assets: portal-client accounts share their servicing
--      firm's firm_id (see supabase/functions/user-management/index.ts), so
--      the existing firm-scoped policy alone lets any client of a firm read
--      every other client's documents at that same firm. This migration adds
--      a client-scoped carve-out for role='client' callers and revokes the
--      firm-wide grant for that role specifically, while leaving staff
--      access (firm_admin/partner_ca/manager/staff_article/superadmin)
--      unchanged.
--
-- Apply via: npx supabase db query --linked "$(cat supabase/migrations/20260807020000_tenant_rls_hardening.sql)"
-- (per CLAUDE.md §5/§10 — requires a local session or SUPABASE_ACCESS_TOKEN).
-- Verify row counts for each table are unchanged (this only changes access,
-- never data) with a quick `SELECT count(*) FROM <table>` before/after as a
-- sanity check.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1. tally_groups / tally_ledgers / tally_trial_balance / tally_vouchers /
--       sync_batches — scope via audit_engagements.firm_id (no firm_id column
--       of their own on these tables). ─────────────────────────────────────

-- Drop the old USING(true) policies from 20260421040000_tally_tables_rls_and_insert.sql
DROP POLICY IF EXISTS "tg_select" ON tally_groups;
DROP POLICY IF EXISTS "tg_insert" ON tally_groups;
DROP POLICY IF EXISTS "tg_update" ON tally_groups;
DROP POLICY IF EXISTS "tg_delete" ON tally_groups;
CREATE POLICY "tally_groups_select_tenant" ON tally_groups FOR SELECT TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_groups.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_groups_insert_tenant" ON tally_groups FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_groups.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_groups_update_tenant" ON tally_groups FOR UPDATE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_groups.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_groups_delete_tenant" ON tally_groups FOR DELETE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_groups.engagement_id AND ae.firm_id = current_user_firm_id())
);

DROP POLICY IF EXISTS "tl_select" ON tally_ledgers;
DROP POLICY IF EXISTS "tl_insert" ON tally_ledgers;
DROP POLICY IF EXISTS "tl_update" ON tally_ledgers;
DROP POLICY IF EXISTS "tl_delete" ON tally_ledgers;
CREATE POLICY "tally_ledgers_select_tenant" ON tally_ledgers FOR SELECT TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_ledgers.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_ledgers_insert_tenant" ON tally_ledgers FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_ledgers.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_ledgers_update_tenant" ON tally_ledgers FOR UPDATE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_ledgers.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_ledgers_delete_tenant" ON tally_ledgers FOR DELETE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_ledgers.engagement_id AND ae.firm_id = current_user_firm_id())
);

DROP POLICY IF EXISTS "ttb_select" ON tally_trial_balance;
DROP POLICY IF EXISTS "ttb_insert" ON tally_trial_balance;
DROP POLICY IF EXISTS "ttb_update" ON tally_trial_balance;
DROP POLICY IF EXISTS "ttb_delete" ON tally_trial_balance;
CREATE POLICY "tally_tb_select_tenant" ON tally_trial_balance FOR SELECT TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_trial_balance.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_tb_insert_tenant" ON tally_trial_balance FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_trial_balance.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_tb_update_tenant" ON tally_trial_balance FOR UPDATE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_trial_balance.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_tb_delete_tenant" ON tally_trial_balance FOR DELETE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_trial_balance.engagement_id AND ae.firm_id = current_user_firm_id())
);

DROP POLICY IF EXISTS "tv_select" ON tally_vouchers;
DROP POLICY IF EXISTS "tv_insert" ON tally_vouchers;
DROP POLICY IF EXISTS "tv_update" ON tally_vouchers;
DROP POLICY IF EXISTS "tv_delete" ON tally_vouchers;
CREATE POLICY "tally_vouchers_select_tenant" ON tally_vouchers FOR SELECT TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_vouchers.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_vouchers_insert_tenant" ON tally_vouchers FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_vouchers.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_vouchers_update_tenant" ON tally_vouchers FOR UPDATE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_vouchers.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "tally_vouchers_delete_tenant" ON tally_vouchers FOR DELETE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = tally_vouchers.engagement_id AND ae.firm_id = current_user_firm_id())
);

DROP POLICY IF EXISTS "sb_select" ON sync_batches;
DROP POLICY IF EXISTS "sb_insert" ON sync_batches;
DROP POLICY IF EXISTS "sb_update" ON sync_batches;
DROP POLICY IF EXISTS "sb_delete" ON sync_batches;
CREATE POLICY "sync_batches_select_tenant" ON sync_batches FOR SELECT TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = sync_batches.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "sync_batches_insert_tenant" ON sync_batches FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = sync_batches.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "sync_batches_update_tenant" ON sync_batches FOR UPDATE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = sync_batches.engagement_id AND ae.firm_id = current_user_firm_id())
);
CREATE POLICY "sync_batches_delete_tenant" ON sync_batches FOR DELETE TO authenticated USING (
  is_superadmin() OR EXISTS (SELECT 1 FROM audit_engagements ae WHERE ae.id = sync_batches.engagement_id AND ae.firm_id = current_user_firm_id())
);

REVOKE ALL ON tally_groups, tally_ledgers, tally_trial_balance, tally_vouchers, sync_batches FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON tally_groups, tally_ledgers, tally_trial_balance, tally_vouchers, sync_batches TO authenticated;


-- ── 2. sync_requests — has its own firm_id column directly. ────────────────

DROP POLICY IF EXISTS "Authenticated users can read sync_requests" ON sync_requests;
DROP POLICY IF EXISTS "Authenticated users can insert sync_requests" ON sync_requests;
DROP POLICY IF EXISTS "Service role can update sync_requests" ON sync_requests;

CREATE POLICY "sync_requests_select_tenant" ON sync_requests FOR SELECT TO authenticated USING (
  is_superadmin() OR firm_id = current_user_firm_id()
);
CREATE POLICY "sync_requests_insert_tenant" ON sync_requests FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR firm_id = current_user_firm_id()
);
-- UPDATE is intentionally left permissive: the local Tally-sync desktop agent
-- polls/updates this table using the service_role key (bypasses RLS anyway),
-- and no evidence was found of it using a per-firm authenticated session.
CREATE POLICY "sync_requests_update_service" ON sync_requests FOR UPDATE TO authenticated USING (
  is_superadmin() OR firm_id = current_user_firm_id()
);

REVOKE ALL ON sync_requests FROM anon;
GRANT SELECT, INSERT, UPDATE ON sync_requests TO authenticated;


-- ── 3. engagements (lightweight lookup table, distinct from audit_engagements)
--       — has its own firm_id column directly. ─────────────────────────────

DROP POLICY IF EXISTS "eng_select" ON engagements;
DROP POLICY IF EXISTS "eng_insert" ON engagements;
DROP POLICY IF EXISTS "eng_update" ON engagements;

CREATE POLICY "engagements_select_tenant" ON engagements FOR SELECT TO authenticated USING (
  is_superadmin() OR firm_id = current_user_firm_id()
);
CREATE POLICY "engagements_insert_tenant" ON engagements FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR firm_id = current_user_firm_id()
);
CREATE POLICY "engagements_update_tenant" ON engagements FOR UPDATE TO authenticated USING (
  is_superadmin() OR firm_id = current_user_firm_id()
);

REVOKE ALL ON engagements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON engagements TO authenticated;


-- ── 4. itr_profiles — reinstate firm-scoped writes. SEE HEADER NOTE #2. ────

DROP POLICY IF EXISTS "Auth insert itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Auth update itr_profiles" ON public.itr_profiles;
DROP POLICY IF EXISTS "Auth delete itr_profiles" ON public.itr_profiles;

CREATE POLICY "itr_profiles_insert_tenant" ON public.itr_profiles
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "itr_profiles_update_tenant" ON public.itr_profiles
  FOR UPDATE TO authenticated
  USING      (is_superadmin() OR firm_id = current_user_firm_id())
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "itr_profiles_delete_tenant" ON public.itr_profiles
  FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());


-- ── 5. documents — add client-scoping on top of the existing firm-scoping so
--       a portal-client account can only reach their OWN client's documents,
--       not every client of the servicing firm. Staff roles are unaffected. ─

DROP POLICY IF EXISTS "Firm select documents" ON public.documents;
DROP POLICY IF EXISTS "Firm insert documents" ON public.documents;
DROP POLICY IF EXISTS "Firm update documents" ON public.documents;
DROP POLICY IF EXISTS "Firm delete documents" ON public.documents;

CREATE POLICY "documents_select_staff" ON public.documents FOR SELECT TO authenticated USING (
  is_superadmin() OR (current_user_role() <> 'client' AND firm_id = current_user_firm_id())
);
CREATE POLICY "documents_insert_staff" ON public.documents FOR INSERT TO authenticated WITH CHECK (
  is_superadmin() OR (current_user_role() <> 'client' AND firm_id = current_user_firm_id())
);
CREATE POLICY "documents_update_staff" ON public.documents FOR UPDATE TO authenticated USING (
  is_superadmin() OR (current_user_role() <> 'client' AND firm_id = current_user_firm_id())
);
CREATE POLICY "documents_delete_staff" ON public.documents FOR DELETE TO authenticated USING (
  is_superadmin() OR (current_user_role() <> 'client' AND firm_id = current_user_firm_id())
);

CREATE POLICY "documents_select_own_client" ON public.documents FOR SELECT TO authenticated USING (
  current_user_role() = 'client' AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
);
CREATE POLICY "documents_insert_own_client" ON public.documents FOR INSERT TO authenticated WITH CHECK (
  current_user_role() = 'client' AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
);
CREATE POLICY "documents_update_own_client" ON public.documents FOR UPDATE TO authenticated USING (
  current_user_role() = 'client' AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
);
CREATE POLICY "documents_delete_own_client" ON public.documents FOR DELETE TO authenticated USING (
  current_user_role() = 'client' AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
);


-- ── 6. firm-assets storage bucket — was public=true with blanket
--       authenticated INSERT/UPDATE/DELETE (no firm/client scoping at all).
--       Storage object paths in this app consistently start with either
--       "firms/<firm_id>/..." or "clients/<client_id>/...". Scope by
--       extracting whichever segment is present and matching it against the
--       caller's own firm (or, for a client, their own client row). ────────

UPDATE storage.buckets SET public = false WHERE id = 'firm-assets';

DROP POLICY IF EXISTS "Authenticated users can upload firm assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update firm assets" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to firm assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete firm assets" ON storage.objects;

CREATE OR REPLACE FUNCTION public.firm_asset_path_authorized(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  firm_seg   text;
  client_seg text;
BEGIN
  IF is_superadmin() THEN
    RETURN true;
  END IF;

  -- "firms/<firm_id>/..." convention
  firm_seg := (regexp_match(object_name, '^firms/([^/]+)/'))[1];
  IF firm_seg IS NOT NULL THEN
    RETURN firm_seg::uuid = current_user_firm_id();
  END IF;

  -- "clients/<client_id>/..." convention (used by portal uploads and some
  -- staff flows without a firms/ prefix)
  client_seg := (regexp_match(object_name, '^clients/([^/]+)/'))[1];
  IF client_seg IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_seg::uuid
        AND (c.firm_id = current_user_firm_id() OR c.user_id = auth.uid())
    );
  END IF;

  -- Path doesn't match either known convention — fail closed rather than
  -- guess. Legitimate paths should always match one of the two above; if a
  -- real flow breaks because of this, its upload path needs updating to a
  -- recognized convention, not this function relaxed to `true`.
  RETURN false;
END;
$$;

CREATE POLICY "firm_assets_select_tenant" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'firm-assets' AND firm_asset_path_authorized(name)
);
CREATE POLICY "firm_assets_insert_tenant" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'firm-assets' AND firm_asset_path_authorized(name)
);
CREATE POLICY "firm_assets_update_tenant" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'firm-assets' AND firm_asset_path_authorized(name)
);
CREATE POLICY "firm_assets_delete_tenant" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'firm-assets' AND firm_asset_path_authorized(name)
);

-- All application reads now go through signed URLs minted server-side (see
-- supabase/functions/get-document-url, fixed in the same audit pass) rather
-- than the bucket's old public URL, so making the bucket non-public does not
-- change the app's normal read path.
