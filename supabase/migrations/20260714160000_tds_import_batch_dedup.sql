/* ─────────────────────────────────────────────────────────────────────────────
   TDS import-batch de-duplication + integrity guard.

   Before the sequential multi-file import feature, every re-import created a NEW
   tds_import_batches row and the old ones were never removed (the old compare
   used only the latest batch, so duplicates were invisible). Now that Validate &
   Finalise reconciles against the UNION of all a filing's batches, those stale
   duplicate batches surface as phantom "extra files" and DOUBLE-COUNT records
   (e.g. UNITY ORGANICS showed TDS_25-26.xls twice = 372+372 duplicate rows).

   This migration:
     1. Collapses duplicates — keeps only the LATEST batch per
        (filing_id, file_name); deleting the rest cascades to tds_imported_rows
        and tds_recon_results (both ON DELETE CASCADE).
     2. Clears the now-stale comparison for every affected filing so the next
        Run Validation recomputes matched/mismatched on the clean dataset.
     3. Adds a partial UNIQUE index so a filing can NEVER again hold two batches
        with the same file name — the importer already replaces same-name batches
        before inserting; this enforces that invariant at the DB level.

   Idempotent. Uses only block comments so it can be applied by collapsing to a
   single line.
   ───────────────────────────────────────────────────────────────────────────── */

DO $$
DECLARE affected uuid[];
BEGIN
  /* filings that currently hold >1 batch for the same file name */
  SELECT array_agg(DISTINCT filing_id) INTO affected
  FROM (
    SELECT filing_id
    FROM public.tds_import_batches
    WHERE file_name IS NOT NULL
    GROUP BY filing_id, file_name
    HAVING count(*) > 1
  ) d;

  /* keep only the most-recently-imported batch per (filing_id, file_name) */
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY filing_id, file_name
             ORDER BY imported_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM public.tds_import_batches
    WHERE file_name IS NOT NULL
  )
  DELETE FROM public.tds_import_batches b
  USING ranked r
  WHERE b.id = r.id AND r.rn > 1;

  /* prior comparison counted the removed duplicate rows → force a clean re-run */
  IF affected IS NOT NULL THEN
    DELETE FROM public.tds_recon_results WHERE filing_id = ANY(affected);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tds_import_batches_uniq_file
  ON public.tds_import_batches (filing_id, file_name)
  WHERE file_name IS NOT NULL;
