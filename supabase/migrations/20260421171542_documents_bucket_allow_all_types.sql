-- Allow all file types in the documents storage bucket.
-- Previously the bucket had allowed_mime_types set to only PDFs and images,
-- which blocked Excel (.xlsx/.xls), Word (.doc/.docx) and other office files.
-- Setting allowed_mime_types = NULL removes the restriction entirely.

UPDATE storage.buckets
SET
  allowed_mime_types = NULL,
  file_size_limit    = 10485760   -- 10 MB (was 5 MB)
WHERE id = 'documents';
