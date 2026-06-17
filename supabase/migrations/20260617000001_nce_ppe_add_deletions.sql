-- ────────────────────────────────────────────────────────────────────────────
-- Migration: NCE PPE Schedule — add `deletions` column
-- ────────────────────────────────────────────────────────────────────────────
-- Adds a per-asset "Deletions" (disposals during the year) column to the PPE
-- schedule. The application now computes:
--
--   total           = opening_balance + additions_pre + additions_post - deletions
--   closing_balance = total - depreciation
--
-- Idempotent (IF NOT EXISTS) and DEFAULT 0 so every existing row stays valid
-- and the depreciation auto-push writer in Depreciation.tsx (which never sets
-- this column) inherits 0 with no behavioural change.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE nce_ppe_schedule
  ADD COLUMN IF NOT EXISTS deletions NUMERIC DEFAULT 0;

COMMENT ON COLUMN nce_ppe_schedule.deletions IS
  'Disposals / deletions of the asset during the year. total = opening + additions_pre + additions_post - deletions.';
