-- ─────────────────────────────────────────────────────────────────────────────
-- TDS Management: Storage buckets + missing columns for Issues 7, 8, 9
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add late_fees_234e to tds_challans (Issue 8) ──────────────────────────
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS late_fees_234e numeric DEFAULT 0;

-- ── 2. Add challan_file_url to tds_challans (Issue 9) ────────────────────────
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS challan_file_url text;

-- ── 3. Add ack_file_url to tds_filings (Issue 7) ─────────────────────────────
ALTER TABLE public.tds_filings
  ADD COLUMN IF NOT EXISTS ack_file_url text;

-- ── 4. Create Supabase Storage buckets ───────────────────────────────────────
-- tds-ack-files: stores acknowledgment / ITR-V files per filing
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tds-ack-files',
  'tds-ack-files',
  false,
  10485760,   -- 10 MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- tds-challan-files: stores challan PDFs per challan record
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tds-challan-files',
  'tds-challan-files',
  false,
  10485760,   -- 10 MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── 5. Storage RLS policies for tds-ack-files ─────────────────────────────────
CREATE POLICY "Authenticated users can upload ACK files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tds-ack-files');

CREATE POLICY "Authenticated users can read ACK files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tds-ack-files');

CREATE POLICY "Authenticated users can update ACK files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'tds-ack-files');

CREATE POLICY "Authenticated users can delete ACK files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tds-ack-files');

-- ── 6. Storage RLS policies for tds-challan-files ────────────────────────────
CREATE POLICY "Authenticated users can upload challan files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tds-challan-files');

CREATE POLICY "Authenticated users can read challan files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tds-challan-files');

CREATE POLICY "Authenticated users can update challan files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'tds-challan-files');

CREATE POLICY "Authenticated users can delete challan files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tds-challan-files');
