-- ─────────────────────────────────────────────────────────────────────────
-- Phase 6 (re-sync flow): stable Tally ledger identity
--
-- PROBLEM
-- coa_mapping is keyed by ledger_name. tally_trial_balance carries no stable
-- Tally master identifier, so when a ledger is RENAMED in Tally the re-sync
-- (delete-then-insert) lands it under a new name, orphaning its COA mapping
-- and dropping it from the financial statements until re-mapped by hand.
--
-- FIX
-- Capture Tally's own immutable ledger GUID (MASTERID / GUID from the Tally
-- XML export) on every TB row. With a stable key, a rename is detectable
-- (same guid, new name) and the mapping can be carried forward automatically
-- instead of relying on fuzzy name matching.
--
-- This migration is the DB half. The WRITE half lives in the external
-- team-package sync agent (see docs/tally-guid-ingestion-spec.md) — it must
-- populate tally_guid on insert. Until that ships, this column is nullable
-- and the in-app fuzzy carry-forward (PipelineStage3 orphan quarantine)
-- remains the fallback.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tally_trial_balance
  ADD COLUMN IF NOT EXISTS tally_guid TEXT;

COMMENT ON COLUMN public.tally_trial_balance.tally_guid IS
  'Immutable Tally ledger master GUID (from XML GUID/MASTERID). Stable across '
  'renames; used to carry COA mappings forward on re-sync. Nullable until the '
  'team-package sync agent populates it.';

-- Look up a ledger by its stable identity within an engagement.
CREATE INDEX IF NOT EXISTS idx_ttb_engagement_guid
  ON public.tally_trial_balance (engagement_id, tally_guid)
  WHERE tally_guid IS NOT NULL;
