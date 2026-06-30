-- Tell PostgREST to drop its in-memory schema cache so the just-added
-- audit_status.audit_report_checked_by column is recognised immediately.
NOTIFY pgrst, 'reload schema';
