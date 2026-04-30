-- ============================================================================
-- audit_firms — make all rows visible to every authenticated user
-- ============================================================================
--
-- Why:
--   The original policy (20260310075213_..) restricted SELECT to rows where
--   firm_id = current_user_firm_id() OR is_superadmin(). In practice CA
--   partnerships routinely operate multiple registered audit firms (e.g.
--   "V. J. Desai & Co." and "K Desai and Associates") that share staff. A
--   junior auditor at one practice firm legitimately needs to pick the
--   audit firm they're signing under from the full list — but the old
--   policy hid co-firms from them, leaving only their own firm in the
--   dropdown.
--
--   audit_firms only contains the firm name + ICAI registration metadata
--   (no client-confidential data), so making it world-readable to any
--   authenticated user is safe. INSERT / UPDATE / DELETE remain firm-scoped.
-- ============================================================================

DROP POLICY IF EXISTS "firm_scope_select" ON public.audit_firms;
DROP POLICY IF EXISTS "all_authenticated_select" ON public.audit_firms;

CREATE POLICY "all_authenticated_select"
  ON public.audit_firms
  FOR SELECT
  TO authenticated
  USING (true);
