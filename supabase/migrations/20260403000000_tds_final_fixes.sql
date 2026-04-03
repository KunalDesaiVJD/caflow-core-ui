-- ─────────────────────────────────────────────────────────────────────────────
-- TDS Final Fixes: columns + storage RLS policies
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tds_challans missing columns ──────────────────────────────────────────
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS late_fees_234e  DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fees_used  DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fully_utilized  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin_quarter  TEXT,
  ADD COLUMN IF NOT EXISTS origin_fy       TEXT,
  ADD COLUMN IF NOT EXISTS challan_file_url TEXT;

-- ── 2. tds_filings: ack_file_url ─────────────────────────────────────────────
ALTER TABLE public.tds_filings
  ADD COLUMN IF NOT EXISTS ack_file_url TEXT;

-- ── 3. Storage buckets ───────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tds-ack-files', 'tds-ack-files', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png','application/octet-stream']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tds-challan-files', 'tds-challan-files', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png','application/octet-stream']
) ON CONFLICT (id) DO NOTHING;

-- ── 4. Storage RLS policies for tds-ack-files ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_ack_upload' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_ack_upload" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'tds-ack-files');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_ack_read' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_ack_read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'tds-ack-files');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_ack_update' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_ack_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'tds-ack-files');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_ack_delete' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_ack_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'tds-ack-files');
  END IF;
END $$;

-- ── 5. Storage RLS policies for tds-challan-files ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_challan_file_upload' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_challan_file_upload" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'tds-challan-files');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_challan_file_read' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_challan_file_read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'tds-challan-files');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_challan_file_update' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_challan_file_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'tds-challan-files');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tds_challan_file_delete' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "tds_challan_file_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'tds-challan-files');
  END IF;
END $$;

-- ── 6. Reload PostgREST schema cache ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
