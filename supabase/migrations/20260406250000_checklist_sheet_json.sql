-- ═══════════════════════════════════════════════════════════════════════
-- Checklist Sheet JSON
-- Adds checklist_sheet_json jsonb column to audit_worksheet_master.
-- Stores the 22-row Audit Documentation Checklist (Sheet 6) as a JSON blob.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS checklist_sheet_json JSONB DEFAULT '{}'::JSONB;
