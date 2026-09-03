-- 3CA/3CB+3CD Uploaded By — upload-gated confirmation.
--
-- The "Uploaded By" cell in Audit Tracker → Audit Status used to be a plain
-- name-picker with no proof behind it. This adds the retained files (scanned
-- audit report + filed Form 3CA/3CB+3CD) and the confirmed filing date behind
-- that name, so a name can only be recorded once both files exist.
--
-- Table + bucket + RLS mirror the proven MSME 43B(h) retention pattern in
-- 20260729120000_msme_43b_gst_and_attachments.sql (firm-scoped via
-- public.current_user_firm_id() / public.is_superadmin()).
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policies).

-- ────────────────────────────────────────────────────────────────────────────
--  1. Confirmed filing date on the audit_status row itself
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_status
  ADD COLUMN IF NOT EXISTS upload_date DATE;

-- ────────────────────────────────────────────────────────────────────────────
--  2. Retained upload files (scanned report / filed form)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_status_uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_status_id  uuid NOT NULL REFERENCES public.audit_status(id) ON DELETE CASCADE,
  firm_id          uuid REFERENCES public.firms(id),
  -- 'scanned_report' | 'filed_form'
  kind             text NOT NULL CHECK (kind IN ('scanned_report', 'filed_form')),
  file_name        text NOT NULL,
  mime_type        text,
  size_bytes       bigint,
  /** path within the audit-3ca-uploads storage bucket */
  storage_path     text NOT NULL,
  uploaded_by      uuid REFERENCES public.users(id),
  uploaded_by_name text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_status_uploads_status
  ON public.audit_status_uploads (audit_status_id, kind, created_at DESC);

ALTER TABLE public.audit_status_uploads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_status_uploads' AND policyname = 'firm can view audit_status_uploads') THEN
    CREATE POLICY "firm can view audit_status_uploads"
      ON public.audit_status_uploads FOR SELECT TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_status_uploads' AND policyname = 'firm can insert audit_status_uploads') THEN
    CREATE POLICY "firm can insert audit_status_uploads"
      ON public.audit_status_uploads FOR INSERT TO authenticated
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;

-- Deliberately NO delete policy: retention is the point. A row can be
-- superseded by a newer upload of the same kind but its history stays.

-- ────────────────────────────────────────────────────────────────────────────
--  3. Storage bucket for the files themselves
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('audit-3ca-uploads', 'audit-3ca-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Objects are keyed <firm_id>/<audit_status_id>/<kind>/<filename>, so the
-- first path segment carries the tenant and RLS can be enforced on it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'firm can read audit-3ca-uploads objects') THEN
    CREATE POLICY "firm can read audit-3ca-uploads objects"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'audit-3ca-uploads'
        AND (public.is_superadmin() OR (storage.foldername(name))[1] = public.current_user_firm_id()::text)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'firm can write audit-3ca-uploads objects') THEN
    CREATE POLICY "firm can write audit-3ca-uploads objects"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'audit-3ca-uploads'
        AND (public.is_superadmin() OR (storage.foldername(name))[1] = public.current_user_firm_id()::text)
      );
  END IF;
END $$;
