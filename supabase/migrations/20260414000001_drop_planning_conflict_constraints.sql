-- CP-08 FIX: Drop same-user same-day unique constraints that block multiple
-- audit assignments for the same employee on the same date.
--
-- The constraints may have been added manually in production under either
-- the old table name (planning_calendar) or the current name (audit_planning).
-- Both DROP statements are idempotent — IF NOT EXISTS means they are no-ops
-- when the constraint has never been created.

-- Old table name (planning_calendar)
ALTER TABLE IF EXISTS public.planning_calendar
  DROP CONSTRAINT IF EXISTS planning_calendar_user_id_date_key;
ALTER TABLE IF EXISTS public.planning_calendar
  DROP CONSTRAINT IF EXISTS planning_calendar_assignee_date_unique;

-- Current table name (audit_planning) — cover any variant that may have slipped in
ALTER TABLE IF EXISTS public.audit_planning
  DROP CONSTRAINT IF EXISTS audit_planning_user_id_date_key;
ALTER TABLE IF EXISTS public.audit_planning
  DROP CONSTRAINT IF EXISTS audit_planning_assignee_date_unique;
ALTER TABLE IF EXISTS public.audit_planning
  DROP CONSTRAINT IF EXISTS planning_calendar_user_id_date_key;
ALTER TABLE IF EXISTS public.audit_planning
  DROP CONSTRAINT IF EXISTS planning_calendar_assignee_date_unique;
