-- Engagement deletes: restrict to firm_admin (own firm only) and superadmin.
-- -----------------------------------------------------------------------------
-- Today public.audit_engagements has SELECT / INSERT / UPDATE policies but NO
-- DELETE policy.  With RLS enabled and no DELETE policy, every authenticated
-- DELETE silently returns 0 rows affected — which is the second contributor to
-- the "I deleted it but it's still there" symptom (the first was missing FK
-- cascade, fixed in 20260603000002).
--
-- Per business rule: only firm administrators (for engagements in their own
-- firm) and superadmins (any firm) may delete engagements.  Everyone else
-- gets no DELETE permission, which is what we want.
--
-- The UI in AuditIntelligence.tsx hides the Delete button for other roles, but
-- THIS policy is the enforcement of record — even a malicious client cannot
-- DELETE without the right role.

DROP POLICY IF EXISTS "audit_engagements_delete_admin_only" ON public.audit_engagements;

CREATE POLICY "audit_engagements_delete_admin_only"
  ON public.audit_engagements
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (
          u.role = 'superadmin'
          OR (u.role = 'firm_admin' AND u.firm_id = audit_engagements.firm_id)
        )
    )
  );

COMMENT ON POLICY "audit_engagements_delete_admin_only"
  ON public.audit_engagements IS
  'Only firm_admin (within own firm) and superadmin (anywhere) may DELETE an '
  'engagement. All other roles see no Delete affordance in the UI and cannot '
  'invoke DELETE directly even if they try to bypass.';
