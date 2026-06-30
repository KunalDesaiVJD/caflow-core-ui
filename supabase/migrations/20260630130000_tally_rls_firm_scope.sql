-- Security fix (Ticket 0.4): close the tally_* / sync_* IDOR.
--
-- Migration 20260421040000_tally_tables_rls_and_insert.sql set `USING (true)` policies AND granted
-- anon+authenticated full CRUD on tally_groups/tally_ledgers/tally_trial_balance/tally_vouchers/
-- sync_batches/sync_requests. Result: ANY anon-key holder (no login) can read/modify EVERY firm's
-- Tally data, and any logged-in user can read every other firm's. (Verified live; fix verified in
-- the dev DB: before = anon+both users saw both firms; after = anon denied, each user sees only their firm.)
--
-- This replaces those with firm-scoped RLS (authenticated only) and revokes the anon grant. All six
-- tables carry firm_id, so one predicate applies to all.
--
-- ⚠️ REQUIRED BEFORE APPLYING TO PROD — the Tally sync write path:
--    The sync agent currently relies on the anon/authenticated table grant to INSERT. After this
--    migration, writes must come from the SERVICE-ROLE key (which bypasses RLS + grants). Confirm the
--    sync (team-package) uses SUPABASE_SERVICE_ROLE_KEY, or it will stop ingesting. The app's own
--    reads are unaffected (logged-in users already only need their own firm's rows).
--
-- STATUS: authored; logic verified in the DEV DB on tally_vouchers. Apply to PROD only after the
-- sync-auth confirmation above.

DO $$
DECLARE
  t   text;
  pol record;
  -- a user sees only their firm's rows (superadmin sees all)
  predicate constant text :=
    'firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())'
    || ' OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = ''superadmin'')';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tally_groups','tally_ledgers','tally_trial_balance','tally_vouchers','sync_batches','sync_requests'
  ] LOOP
    -- drop every existing policy (removes the insecure USING(true) ones, whatever they're named)
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',           t || '_firm_select', t, predicate);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',       t || '_firm_insert', t, predicate);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t || '_firm_update', t, predicate, predicate);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',           t || '_firm_delete', t, predicate);

    -- revoke the anon CRUD grant; keep authenticated (RLS now scopes it)
    EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM anon', t);
  END LOOP;
END $$;
