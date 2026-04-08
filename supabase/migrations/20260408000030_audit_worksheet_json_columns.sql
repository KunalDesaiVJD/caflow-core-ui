-- ═══════════════════════════════════════════════════════════════════════════
-- Issue 1: Add JSON blob columns to audit_worksheet_master
-- Root cause: hooks (useTaxMasterStorage, useWorksheetSheetStorage, etc.)
-- reference JSONB columns that were never defined in the original migration
-- (20260406100000_audit_worksheet_module.sql), which only has individual
-- text/numeric columns.  Every upsert fails with "column not found".
--
-- Fix: ADD the five JSON columns used by the new sheet-storage hooks.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS tax_master_json         JSONB,
  ADD COLUMN IF NOT EXISTS worksheet_json          JSONB,
  ADD COLUMN IF NOT EXISTS special_attention_json  JSONB,
  ADD COLUMN IF NOT EXISTS checklist_sheet_json    JSONB,
  ADD COLUMN IF NOT EXISTS query_sheet_json        JSONB,
  ADD COLUMN IF NOT EXISTS statutory_master_json   JSONB;

-- Verify
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'audit_worksheet_master'
  AND column_name  IN (
    'tax_master_json','worksheet_json','special_attention_json',
    'checklist_sheet_json','query_sheet_json','statutory_master_json'
  )
ORDER BY column_name;
