-- Phase-level tracking on sync_batches so the UI can show exactly
-- which step (groups, ledgers, tb, vouchers, voucher-chunk-2025-04) failed and why.

ALTER TABLE sync_batches
  ADD COLUMN IF NOT EXISTS phase_status jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS phase_errors jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS phase_timings jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_type text DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS current_phase text;

CREATE INDEX IF NOT EXISTS idx_sync_batches_engagement_started
  ON sync_batches (engagement_id, started_at DESC);

COMMENT ON COLUMN sync_batches.phase_status  IS 'JSONB map of phase_name → pending|running|completed|failed|skipped';
COMMENT ON COLUMN sync_batches.phase_errors  IS 'JSONB map of phase_name → error message for failed phases';
COMMENT ON COLUMN sync_batches.phase_timings IS 'JSONB map of phase_name → elapsed_ms';
COMMENT ON COLUMN sync_batches.sync_type     IS 'full | step-<phase> | chunked-vouchers';
COMMENT ON COLUMN sync_batches.current_phase IS 'The phase currently running (for in-progress batches)';
