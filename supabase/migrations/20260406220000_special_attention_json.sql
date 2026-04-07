-- ═══════════════════════════════════════════════════════════════════════
-- Special Attention JSON
-- Adds special_attention_json jsonb column to audit_worksheet_master.
-- Stores the Advanced Checklist for Tax & Statutory Auditing as a JSON blob.
-- Also adds isPrivateOrPublicLtd column is NOT needed — computed in frontend.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS special_attention_json JSONB DEFAULT '{}'::JSONB;
