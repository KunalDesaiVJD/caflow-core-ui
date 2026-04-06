-- ═══════════════════════════════════════════════════════════════════════
-- Worksheet JSON
-- Adds worksheet_json jsonb column to audit_worksheet_master.
-- Stores the 9-row Audit Work Sheet (book-category tracking) as a JSON blob.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS worksheet_json JSONB DEFAULT '{}'::JSONB;
