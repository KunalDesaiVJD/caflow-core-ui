-- ═══════════════════════════════════════════════════════════════════════
-- Query Sheet JSON
-- Adds query_sheet_json jsonb column to audit_worksheet_master.
-- Stores the Query Sheet (Sheet 5) rows as a JSON blob array.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS query_sheet_json JSONB DEFAULT '{"queries":[]}'::JSONB;
