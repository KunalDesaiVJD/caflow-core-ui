-- ITR Form / Computation of Income uploads — gates the "Filed" (and "Sent
-- to CPC") transition for Audited clients in IT Returns, mirroring the
-- Audit Tracker "3CA/3CB+3CD Uploaded By" upload-gate pattern.
--
-- itr_profiles already has acknowledgment_no and upload_by columns — no
-- ALTER needed there. This migration only adds the retained-files table
-- and its storage bucket, same pattern as
-- 20260903180000_audit_status_uploads.sql (itself mirroring the proven
-- MSME 43B(h) retention pattern).
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policies).

-- ────────────────────────────────────────────────────────────────────────────
--  1. Retained upload files (ITR form / computation of income)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.itr_status_uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itr_profile_id   uuid NOT NULL REFERENCES public.itr_profiles(id) ON DELETE CASCADE,
  firm_id          uuid REFERENCES public.firms(id),
  -- 'itr_form' | 'computation_of_income'
  kind             text NOT NULL CHECK (kind IN ('itr_form', 'computation_of_income')),
  file_name        text NOT NULL,
  mime_type        text,
  size_bytes       bigint,
  /** path within the itr-filing-uploads storage bucket */
  storage_path     text NOT NULL,
  uploaded_by      uuid REFERENCES public.users(id),
  uploaded_by_name text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itr_status_uploads_profile
  ON public.itr_status_uploads (itr_profile_id, kind, created_at DESC);

ALTER TABLE public.itr_status_uploads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'itr_status_uploads' AND policyname = 'firm can view itr_status_uploads') THEN
    CREATE POLICY "firm can view itr_status_uploads"
      ON public.itr_status_uploads FOR SELECT TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'itr_status_uploads' AND policyname = 'firm can insert itr_status_uploads') THEN
    CREATE POLICY "firm can insert itr_status_uploads"
      ON public.itr_status_uploads FOR INSERT TO authenticated
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;

-- Deliberately NO delete policy: retention is the point. A row can be
-- superseded by a newer upload of the same kind but its history stays.

-- ────────────────────────────────────────────────────────────────────────────
--  2. Storage bucket for the files themselves
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('itr-filing-uploads', 'itr-filing-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Objects are keyed <firm_id>/<itr_profile_id>/<kind>/<filename>, so the
-- first path segment carries the tenant and RLS can be enforced on it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'firm can read itr-filing-uploads objects') THEN
    CREATE POLICY "firm can read itr-filing-uploads objects"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'itr-filing-uploads'
        AND (public.is_superadmin() OR (storage.foldername(name))[1] = public.current_user_firm_id()::text)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'firm can write itr-filing-uploads objects') THEN
    CREATE POLICY "firm can write itr-filing-uploads objects"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'itr-filing-uploads'
        AND (public.is_superadmin() OR (storage.foldername(name))[1] = public.current_user_firm_id()::text)
      );
  END IF;
END $$;
