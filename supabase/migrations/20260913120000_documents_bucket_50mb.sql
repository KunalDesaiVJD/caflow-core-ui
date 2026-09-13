-- Let the documents bucket hold a whole registered deed.
--
-- A registered Gujarati દસ્તાવેજ is a scanned image PDF. The five real deeds
-- measured while building TDS on Property ran 6.5, 10.3 and 19.7 MB across
-- 68, 106 and 202 pages, and a 500-page deed will be larger still. The bucket
-- has capped uploads at 10 MB since 20260421171542, while the property
-- uploader admitted files up to 20 MB — so a 19.7 MB deed passed the app's
-- own guard, was then rejected by storage, and the only thing the user saw
-- was:
--
--     "The file could not be uploaded for reading."
--
-- Both limits now read 50 MB and must move together:
--
--     client guard    50 MB   (TdsPropertyUpload.tsx, MAX_FILE_BYTES)
--     bucket ceiling  50 MB   (here)
--
-- Equal is safe because both tests are inclusive — each rejects on greater
-- than — so a file of exactly 50 MB passes both. 50 MB is also Supabase's
-- own default ceiling for a project's Storage, which a bucket cannot exceed;
-- asking for more here would be clamped there and silently put the two back
-- out of step.
--
-- This costs object storage, not database: the file goes to the bucket and
-- the background reader fetches page ranges from it. Nothing is written to
-- Postgres but the path.
--
-- Additive and reversible: no schema change, no data touched, and every other
-- feature writing to this bucket simply gains headroom it was not using.

UPDATE storage.buckets
SET file_size_limit = 52428800          -- 50 MB (was 10 MB)
WHERE id = 'documents';

-- Shows the result, so running this by hand in the SQL editor confirms
-- itself. If limit_mb comes back lower than 50.0, the PROJECT-wide Storage
-- limit is the binding one — raise it under Storage → Settings in the
-- dashboard, then run this again.
SELECT id,
       file_size_limit,
       round(file_size_limit / 1024.0 / 1024.0, 1) AS limit_mb,
       public
FROM storage.buckets
WHERE id = 'documents';
