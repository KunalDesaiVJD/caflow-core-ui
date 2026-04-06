-- ═══════════════════════════════════════════════════════════════════════
-- Internal Audit Master JSON
-- Adds int_master_json jsonb column to audit_worksheet_master
-- Stores the full Internal Audit Master form as a JSON blob
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS int_master_json JSONB DEFAULT '{}'::JSONB;
