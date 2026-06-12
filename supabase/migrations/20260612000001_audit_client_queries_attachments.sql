-- ──────────────────────────────────────────────────────────────────────────────
-- audit_client_queries.attachments
--
-- Stage 2 (Query Sheet) lets the auditor attach supporting documents to each
-- query row. When the row is dispatched ("Dispatch All" / Bulk Dispatch), the
-- attachments stayed on the worksheet row and never reached the dispatched
-- query in Stage 3 / the client portal — the auditor saw their attachments
-- silently dropped on dispatch.
--
-- ROOT-CAUSE FIX: add a JSONB column on audit_client_queries to carry the same
-- attachment shape the worksheet row uses (QueryAttachment[] from
-- src/components/audit-worksheet/hooks/useQuerySheetStorage.ts):
--   { file_path, file_name, file_type, size }
-- The dispatch handler copies the worksheet row's attachments into this column
-- (concatenated when grouping multiple rows under one head). Existing rows
-- default to an empty array, so the change is non-breaking.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_client_queries
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.audit_client_queries.attachments IS
  'Worksheet-row attachments carried forward at dispatch. Array of '
  '{ file_path, file_name, file_type, size } objects pointing into the '
  '"documents" Supabase Storage bucket. Default [] so the column is safe '
  'to add to an existing table.';
