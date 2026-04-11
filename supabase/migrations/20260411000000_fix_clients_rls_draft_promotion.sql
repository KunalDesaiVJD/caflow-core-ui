-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Fix RLS policies so draft → final promotion works for all
--            authenticated users, including API-imported client records.
--
-- Root Cause D: The existing UPDATE policy on the clients table may be
-- scoped too narrowly (e.g. only allows updates on rows created by the
-- current user).  API-created clients have user_id = the API service
-- account, not the logged-in CA, so the CA's session cannot update
-- is_draft even though they own the firm.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Drop any existing overlapping UPDATE policies that may block ──────

-- Drop by name if they exist (safe — no error if they don't exist)
DO $$
BEGIN
  -- Drop narrow "own row only" update policies if present
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'clients'
      AND policyname = 'Users can update own clients'
  ) THEN
    DROP POLICY "Users can update own clients" ON public.clients;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'clients'
      AND policyname = 'Allow status update'
  ) THEN
    DROP POLICY "Allow status update" ON public.clients;
  END IF;
END $$;


-- ── 2. Firm-scoped UPDATE policy ─────────────────────────────────────────
-- A CA (or manager/staff) can update ANY client that belongs to their firm,
-- regardless of which user_id originally created the row.
-- Superadmins can update any client in any firm.

CREATE POLICY "clients_update_firm_members"
ON public.clients
FOR UPDATE
USING (
  -- Superadmin: unrestricted
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'superadmin'
  )
  OR
  -- Firm member: must belong to the same firm as the client
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id      = auth.uid()
      AND u.firm_id = public.clients.firm_id
      AND u.is_active = true
  )
)
WITH CHECK (
  -- Same conditions apply to the new row values
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'superadmin'
  )
  OR
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id      = auth.uid()
      AND u.firm_id = public.clients.firm_id
      AND u.is_active = true
  )
);


-- ── 3. Ensure RLS is enabled on the clients table ────────────────────────
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;


-- ── 4. Verify: list all policies on clients after migration ──────────────
-- Run this in the Supabase SQL editor to confirm:
--   SELECT policyname, cmd, qual FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'clients'
--   ORDER BY policyname;


-- ── 5. Grant UPDATE permission to authenticated role (if missing) ─────────
GRANT UPDATE ON public.clients TO authenticated;


-- ── NOTES ─────────────────────────────────────────────────────────────────
-- • If the UPDATE still fails after this migration, check whether your
--   Supabase project uses a custom schema other than 'public'.
-- • The UI code logs the exact DB error to the browser console AND shows
--   it as a toast: look for "[ClientDetail] Promotion FAILED:" in DevTools.
-- • Test the promotion manually by running in the SQL editor:
--     UPDATE public.clients
--     SET is_draft = false, updated_at = now()
--     WHERE id = '<your-draft-client-id>';
--   If it succeeds as the service role but fails as authenticated, the
--   issue is confirmed RLS and this migration resolves it.
