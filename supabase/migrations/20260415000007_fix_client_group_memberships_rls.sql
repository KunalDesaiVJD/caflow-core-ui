-- Fix client_group_memberships RLS so non-superadmin users can see and manage
-- memberships for ALL groups that belong to their firm OR are global (firm_id IS NULL).
--
-- Root cause: the original policies only matched groups WHERE firm_id = current_user_firm_id().
-- Groups created by a superadmin may have firm_id = NULL (global groups).
-- The companion table client_groups already had firm_id IS NULL added in migration
-- 20260327072541, but client_group_memberships was never updated to match.
--
-- Result: staff users could see groups in the picker (correct) but the memberships
-- query returned 0 rows, showing "Ungrouped" even when the client was in a group.

-- ── client_group_memberships ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "firm_scope_select" ON public.client_group_memberships;
DROP POLICY IF EXISTS "firm_scope_insert" ON public.client_group_memberships;
DROP POLICY IF EXISTS "firm_scope_update" ON public.client_group_memberships;
DROP POLICY IF EXISTS "firm_scope_delete" ON public.client_group_memberships;

-- Matches the updated client_groups SELECT policy (firm_id IS NULL = global group)
CREATE POLICY "firm_scope_select" ON public.client_group_memberships
  FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR group_id IN (
      SELECT id FROM public.client_groups
      WHERE firm_id IS NULL OR firm_id = current_user_firm_id()
    )
  );

CREATE POLICY "firm_scope_insert" ON public.client_group_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    is_superadmin()
    OR group_id IN (
      SELECT id FROM public.client_groups
      WHERE firm_id IS NULL OR firm_id = current_user_firm_id()
    )
  );

CREATE POLICY "firm_scope_update" ON public.client_group_memberships
  FOR UPDATE TO authenticated
  USING (
    is_superadmin()
    OR group_id IN (
      SELECT id FROM public.client_groups
      WHERE firm_id IS NULL OR firm_id = current_user_firm_id()
    )
  );

CREATE POLICY "firm_scope_delete" ON public.client_group_memberships
  FOR DELETE TO authenticated
  USING (
    is_superadmin()
    OR group_id IN (
      SELECT id FROM public.client_groups
      WHERE firm_id IS NULL OR firm_id = current_user_firm_id()
    )
  );
