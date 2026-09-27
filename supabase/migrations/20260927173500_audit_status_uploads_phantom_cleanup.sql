-- One-time data-integrity repair for the "3CA/3CB+3CD Uploaded By" gate.
--
-- Before the upload-confirm dialog existed, `uploaded_by` was a plain,
-- freely-editable name field with no file requirement behind it. Those
-- legacy rows now render identically to a genuinely-completed upload (a
-- name + green "confirmed" styling) even though audit_status_uploads has
-- no scanned_report/filed_form row for them — and the current UI offers no
-- way to tell them apart or clear one. Confirmed against live data: 210
-- rows currently have uploaded_by set without both required files on file.
--
-- This clears uploaded_by/upload_date on exactly those rows so the column
-- once again means what it says. It does NOT touch audit_status_uploads —
-- retention of any files that DO exist is untouched; a row with a genuine
-- partial upload keeps that file discoverable if the dialog is reopened,
-- it just no longer claims to be "done" until the missing file is added.
--
-- SAFETY: idempotent — re-running only affects rows still violating the
-- invariant (there will be none after the first run, since nothing in the
-- current app can create a new violation going forward).

UPDATE public.audit_status a
SET uploaded_by = NULL, upload_date = NULL
WHERE a.uploaded_by IS NOT NULL
  AND a.uploaded_by <> 'NA'
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.audit_status_uploads u
      WHERE u.audit_status_id = a.id AND u.kind = 'scanned_report'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.audit_status_uploads u
      WHERE u.audit_status_id = a.id AND u.kind = 'filed_form'
    )
  );
