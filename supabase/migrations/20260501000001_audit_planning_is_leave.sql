-- Issue 3 (Leave leakage): leaves recorded by employees on the planning calendar
-- must NEVER affect audit_status, audit_communication, dashboard reminders,
-- or any client-facing aggregate. Until now we relied on
-- (client_id IS NULL OR LOWER(client_name)='leave') heuristics scattered across
-- the codebase, which is fragile.
--
-- This migration adds an explicit boolean flag so every consumer can filter
-- leaves with a single, deterministic predicate: `is_leave = false`.

ALTER TABLE audit_planning
  ADD COLUMN IF NOT EXISTS is_leave BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: any historical row whose client_name is the literal "Leave"
-- (case-insensitive, trimmed) is a leave.
UPDATE audit_planning
   SET is_leave = TRUE
 WHERE is_leave = FALSE
   AND LOWER(TRIM(COALESCE(client_name, ''))) = 'leave';

-- Helpful index for the dashboard reminder query (employee_ids @> ARRAY[uid] AND is_leave=false)
CREATE INDEX IF NOT EXISTS idx_audit_planning_is_leave ON audit_planning(is_leave);

COMMENT ON COLUMN audit_planning.is_leave IS
  'TRUE = personal leave entry (employee unavailable). Such rows must be excluded from audit_status virtual rows, audit_communication backfills, and dashboard audit reminders. They appear ONLY on the planning calendar.';
