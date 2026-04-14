-- ─────────────────────────────────────────────────────────────────────────────
-- TDS ACK File System
-- Creates:
--   1. 'documents' storage bucket (public) — so getPublicUrl() works without RLS
--   2. Upload RLS policy on storage.objects for authenticated users
--   3. tds_ack_files table — 1:1 link between tds_filing and uploaded ACK PDF
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Create or make-public the 'documents' storage bucket ──────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  true,           -- PUBLIC so getPublicUrl() works without createSignedUrl RLS
  10485760,       -- 10 MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. Storage RLS: allow authenticated users to upload to 'documents' ────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'documents_auth_insert'
  ) THEN
    CREATE POLICY "documents_auth_insert"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'documents_auth_select'
  ) THEN
    CREATE POLICY "documents_auth_select"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'documents_auth_delete'
  ) THEN
    CREATE POLICY "documents_auth_delete"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'documents');
  END IF;
END $$;

-- ── 3. tds_ack_files table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_ack_files (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  filing_id  UUID        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  client_id  TEXT        NOT NULL,
  firm_id    TEXT,
  file_name  TEXT        NOT NULL,
  file_url   TEXT        NOT NULL,
  user_id    UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 4. RLS on tds_ack_files ───────────────────────────────────────────────────
ALTER TABLE public.tds_ack_files ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'tds_ack_files'
      AND policyname = 'tds_ack_files_select'
  ) THEN
    CREATE POLICY "tds_ack_files_select"
      ON public.tds_ack_files FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'tds_ack_files'
      AND policyname = 'tds_ack_files_insert'
  ) THEN
    CREATE POLICY "tds_ack_files_insert"
      ON public.tds_ack_files FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'tds_ack_files'
      AND policyname = 'tds_ack_files_delete'
  ) THEN
    CREATE POLICY "tds_ack_files_delete"
      ON public.tds_ack_files FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- ── 5. Index for fast per-filing lookup ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tds_ack_files_filing_id ON public.tds_ack_files(filing_id);

-- ── 6. Verify ─────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM storage.buckets WHERE id = 'documents' AND public = true) AS documents_bucket_public,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'tds_ack_files')                AS tds_ack_files_table;
