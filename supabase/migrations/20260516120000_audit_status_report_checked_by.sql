-- Add "Audit Report Checked By" column to audit_status.
--
-- Sits beside audit_report_prepared_by and stores the user/employee who
-- reviewed the audit report. Nullable text; the UI renders it as a
-- UserCombobox populated from the firm's active users.
--
-- Idempotent — uses IF NOT EXISTS so re-running the migration is safe.

ALTER TABLE public.audit_status
  ADD COLUMN IF NOT EXISTS audit_report_checked_by text NULL;

COMMENT ON COLUMN public.audit_status.audit_report_checked_by IS
  'Name of the user/employee who checked the audit report. UI renders this as a searchable dropdown of firm users.';
