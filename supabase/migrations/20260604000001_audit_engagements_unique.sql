-- 20260604000001_audit_engagements_unique.sql
--
-- Prevent duplicate engagements at the database layer.
--
-- Root cause being addressed:
--   The app's pre-insert check at AuditPipeline.tsx was over-strict
--   (filtered by firm_id and status != 'archived'), so duplicates with
--   mismatched firm_id, NULL audit_period_type, or archived siblings
--   slipped through. SWADESHI LABORATORIES, BAPASITARAM DEVELOPERS,
--   DHAWAL ADRITECH and others all ended up with 2-3 duplicate rows for
--   the same (client, FY, audit_type) tuple.
--
-- Rule:
--   No two LIVE non-PY-shell engagements may share
--   (client_id, financial_year, audit_type, COALESCE(audit_period_type, 'annual')).
--
-- Why partial:
--   - Archived engagements are excluded so historical archived rows from
--     before the auto-archive fix don't block legitimate new inserts.
--   - PY-shell engagements (is_py_shell=true) are FY-1 comparative-only
--     placeholders and intentionally share the (client, FY-1, audit_type)
--     tuple of the prior-year engagement that may also exist; they must
--     not interfere with the constraint.
--
-- This index is the conflict target for the upsert() at
-- AuditPipeline.tsx createEngagement.mutate().

CREATE UNIQUE INDEX IF NOT EXISTS audit_engagements_unique_live
  ON public.audit_engagements (
    client_id,
    financial_year,
    audit_type,
    COALESCE(audit_period_type, 'annual')
  )
  WHERE status <> 'archived'
    AND (is_py_shell IS NULL OR is_py_shell = false);

COMMENT ON INDEX public.audit_engagements_unique_live IS
  'Stops duplicate live engagements per (client, FY, audit_type, period). '
  'Pre-fix archived rows and PY-shell comparatives are excluded. '
  'Created 2026-06-04 in response to SWADESHI / BAPASITARAM duplicate-creation bug.';
