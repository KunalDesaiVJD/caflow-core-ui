/* ─────────────────────────────────────────────────────────────────────────────
   Stage-2 PAN Verification — multi-file support (parity with Stage-1 import).

   A firm may split the TRACES Bulk-PAN output across several files (per section /
   batch of PANs). Stage-2 now unions ALL of a filing's TRACES batches, exactly
   like Stage-1 unions its import files. This migration makes that safe:

     1. Collapses any pre-existing duplicate batches — keeps only the LATEST batch
        per (filing_id, file_name); the rest cascade to
        tds_pan_verification_rows (ON DELETE CASCADE).
     2. Clears the now-stale audit results for every affected filing so the next
        Run Validation recomputes over the clean, de-duplicated union.
     3. Adds a partial UNIQUE index so a filing can NEVER again hold two batches
        with the same file name — re-importing the same file REPLACES it.
     4. Relaxes tds_pan_verification_results.batch_id to NULLABLE + ON DELETE SET
        NULL. With the union model an audit result is OFFICE-driven, not owned by
        one batch; deleting a single TRACES file must not cascade-delete the audit
        results (they are regenerated on the next Run Validation).

   Idempotent. Block comments only (applied by collapsing to a single line).
   ───────────────────────────────────────────────────────────────────────────── */

DO $$
DECLARE affected uuid[];
BEGIN
  /* filings that currently hold >1 batch for the same file name */
  SELECT array_agg(DISTINCT filing_id) INTO affected
  FROM (
    SELECT filing_id
    FROM public.tds_pan_verification_batches
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
    FROM public.tds_pan_verification_batches
    WHERE file_name IS NOT NULL
  )
  DELETE FROM public.tds_pan_verification_batches b
  USING ranked r
  WHERE b.id = r.id AND r.rn > 1;

  /* prior audit counted the removed duplicate rows → force a clean re-run */
  IF affected IS NOT NULL THEN
    DELETE FROM public.tds_pan_verification_results WHERE filing_id = ANY(affected);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tds_pan_ver_batches_uniq_file
  ON public.tds_pan_verification_batches (filing_id, file_name)
  WHERE file_name IS NOT NULL;

/* results.batch_id → nullable + ON DELETE SET NULL (see header note 4) */
ALTER TABLE public.tds_pan_verification_results ALTER COLUMN batch_id DROP NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tds_pan_verification_results_batch_id_fkey'
      AND table_name = 'tds_pan_verification_results'
  ) THEN
    ALTER TABLE public.tds_pan_verification_results
      DROP CONSTRAINT tds_pan_verification_results_batch_id_fkey;
  END IF;
  ALTER TABLE public.tds_pan_verification_results
    ADD CONSTRAINT tds_pan_verification_results_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES public.tds_pan_verification_batches(id) ON DELETE SET NULL;
END $$;
