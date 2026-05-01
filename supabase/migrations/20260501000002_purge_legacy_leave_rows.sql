-- Issue 3 follow-up: legacy data cleanup.
-- Before the is_leave isolation fix, every "Leave" entry from the planning
-- calendar fan-out into audit_communication AND audit_status, polluting the
-- Communication Log and Audit Status grid. Those legacy rows still exist and
-- the new is_leave filter only prevents future leaks. This migration removes
-- the historical pollution.

-- Drop communication-log rows that were auto-created from a leave plan.
DELETE FROM audit_communication
 WHERE LOWER(TRIM(COALESCE(client_name, ''))) = 'leave';

-- Drop audit_status rows that were auto-created from a leave plan.
-- We match on party_name only (client_id is NULL for leaves).
DELETE FROM audit_status
 WHERE (client_id IS NULL OR client_id::text = '')
   AND LOWER(TRIM(COALESCE(party_name, ''))) = 'leave';
