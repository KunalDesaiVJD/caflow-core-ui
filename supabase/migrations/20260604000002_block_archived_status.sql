-- 20260604000002_block_archived_status.sql
--
-- Permanently prevent any code path from setting audit_engagements.status
-- to 'archived'. The user policy is: engagements are either ACTIVE or
-- HARD-DELETED — never archived. The auto-archive code paths have already
-- been removed from the app (see auditEngagementSync.ts), but a DB-level
-- trigger is the last-line defence against:
--   - Future regressions introducing a new archive call site
--   - Direct SQL editor / Supabase Studio writes
--   - Third-party integrations / cron jobs
--
-- Implementation: a BEFORE UPDATE OR INSERT trigger that raises an
-- exception whenever NEW.status = 'archived'. Existing archived rows are
-- left alone (none exist after the 2026-06-04 cleanup, but the trigger
-- doesn't fire on rows you never touch).

CREATE OR REPLACE FUNCTION public.block_archived_engagement_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'archived' THEN
    RAISE EXCEPTION
      'Setting audit_engagements.status to ''archived'' is not permitted. '
      'Engagements must be either active or permanently deleted. '
      'See migration 20260604000002 for rationale.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_archived_engagement_status_trigger
  ON public.audit_engagements;

CREATE TRIGGER block_archived_engagement_status_trigger
  BEFORE INSERT OR UPDATE OF status
  ON public.audit_engagements
  FOR EACH ROW
  EXECUTE FUNCTION public.block_archived_engagement_status();

COMMENT ON FUNCTION public.block_archived_engagement_status() IS
  'Refuses any INSERT or UPDATE that would set audit_engagements.status to '
  '''archived''. Engagements are hard-deleted, never archived. '
  'Created 2026-06-04 alongside the locked-Edit dialog change.';
