-- Raise the documents bucket ceiling above the app's own upload guard.
--
-- A registered Gujarati દસ્તાવેજ is a scanned image PDF. The five real deeds
-- measured while building TDS on Property ran 6.5, 10.3 and 19.7 MB across
-- 68, 106 and 202 pages. The documents bucket has capped uploads at 10 MB
-- since 20260421171542, while the property uploader admitted files up to
-- 20 MB — so a 19.7 MB deed passed the app's guard, was then rejected by
-- storage, and the only thing the user saw was:
--
--     "The file could not be uploaded for reading."
--
-- That ordering was backwards. The bucket ceiling now sits ABOVE the client
-- guard, so the guard is the binding limit and its message is the true one:
--
--     client guard    20 MB   (TdsPropertyUpload.tsx, MAX_FILE_BYTES)
--     bucket ceiling  25 MB   (here)
--
-- The background reader makes this load-bearing rather than cosmetic: it
-- reads the deed FROM storage in page ranges, so a file that never lands in
-- the bucket cannot be read at all.
--
-- Additive and reversible: no schema change, no data touched, and every other
-- feature writing to this bucket simply gains headroom it was not using.

UPDATE storage.buckets
SET file_size_limit = 26214400          -- 25 MB (was 10 MB)
WHERE id = 'documents';

-- Show the result, so running this by hand in the SQL editor confirms itself.
SELECT id,
       file_size_limit,
       round(file_size_limit / 1024.0 / 1024.0, 1) AS limit_mb,
       public
FROM storage.buckets
WHERE id = 'documents';
