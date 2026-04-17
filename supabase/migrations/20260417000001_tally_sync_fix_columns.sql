-- Fix missing tally_company column on tally_* tables
-- These tables were created without this column causing all sync pushes to fail

ALTER TABLE tally_groups        ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE tally_ledgers       ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE tally_vouchers      ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE tally_trial_balance ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE sync_batches        ADD COLUMN IF NOT EXISTS tally_company TEXT;

-- Ensure indexes exist for engagement-scoped queries
CREATE INDEX IF NOT EXISTS idx_tg_engagement  ON tally_groups(engagement_id);
CREATE INDEX IF NOT EXISTS idx_tl_engagement  ON tally_ledgers(engagement_id);
CREATE INDEX IF NOT EXISTS idx_ttb_engagement ON tally_trial_balance(engagement_id);
CREATE INDEX IF NOT EXISTS idx_tv_engagement  ON tally_vouchers(engagement_id);
CREATE INDEX IF NOT EXISTS idx_sb_engagement  ON sync_batches(engagement_id);
