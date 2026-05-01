-- Stamp every tally_trial_balance row with the version of sync code that
-- produced it.  The UI compares this against a constant LATEST_SYNC_CODE_VERSION
-- and surfaces a "stale data — please re-sync" banner when a row was synced
-- under an older code version.  This closes the code-fix-vs-data-fix gap:
-- deployed bug-fixes (Stock-in-Hand opening, Duties & Taxes parent-group,
-- HTML-entity decoding, etc.) only act during a sync run, so existing rows
-- written by older code remain wrong until they're rewritten.  The banner
-- alerts the user that a resync (or `heal-stock.bat`) is required.

ALTER TABLE public.tally_trial_balance
  ADD COLUMN IF NOT EXISTS sync_code_version TEXT;

COMMENT ON COLUMN public.tally_trial_balance.sync_code_version IS
  'Version stamp from sync-step.js (SYNC_CODE_VERSION constant). Bumped whenever a TB-affecting bug-fix lands. UI shows a "stale" banner when row version < LATEST_SYNC_CODE_VERSION.';
