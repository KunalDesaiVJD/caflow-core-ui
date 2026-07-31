-- ─────────────────────────────────────────────────────────────────────────────
-- TDS import batches: store the original uploaded file, not just its parsed rows
--
-- All three TDS Validate & Finalise import stages (Stage 1 data reconciliation,
-- Stage 2 PAN Verification, Stage 3 Tally reconciliation) parse the picked file
-- in the browser and persist only the extracted rows — the original .xlsx/.xls/
-- .pdf bytes were discarded the moment parsing finished, so "download the file
-- I imported" was never possible at any stage.
--
-- Adds file_url to each batch table, populated by uploading the original file to
-- the existing public 'documents' bucket (already used for TDS ACK receipts,
-- already unrestricted on mime type/size per 20260421171542_documents_bucket_
-- allow_all_types.sql) — no bucket/policy change needed, only these columns.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tds_import_batches ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE public.tds_pan_verification_batches ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE public.tds_tally_batches ADD COLUMN IF NOT EXISTS file_url TEXT;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_import_batches' AND column_name = 'file_url') AS import_batches_has_file_url,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_pan_verification_batches' AND column_name = 'file_url') AS pan_batches_has_file_url,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_tally_batches' AND column_name = 'file_url') AS tally_batches_has_file_url;
