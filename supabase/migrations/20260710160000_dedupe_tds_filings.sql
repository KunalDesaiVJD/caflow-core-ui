-- Dedupe tds_filings: the pre-form-config-driven auto-creation logic could
-- run concurrently and insert duplicate rows for the same
-- (client_id, financial_year, quarter, tds_forms) — inflating the Dashboard's
-- "Returns Due" count (which counts filing rows) independent of the actual
-- "Active TDS Clients" count (which counts distinct clients).
--
-- Only deletes a duplicate row when it is a genuine empty placeholder in its
-- CURRENT state (no challans, no deductees, no ack number, no filing date,
-- status still Not Started/Not Applicable) AND at least one other row
-- remains in the same group afterward — so no filing period is ever fully
-- removed, and any row carrying real entered data is never touched.
--
-- A small number of duplicate groups (verified: 3 rows across 2 clients)
-- have real, DIFFERING data on more than one row in the same group and are
-- deliberately left untouched here for manual review in the app.

WITH ranked AS (
  SELECT
    tf.id,
    ROW_NUMBER() OVER (
      PARTITION BY tf.client_id, tf.financial_year, tf.quarter, tf.tds_forms
      ORDER BY (SELECT COUNT(*) FROM public.tds_challans WHERE filing_id = tf.id) DESC, tf.created_at ASC
    ) AS rn,
    (SELECT COUNT(*) FROM public.tds_challans WHERE filing_id = tf.id) AS challan_count,
    (SELECT COUNT(*) FROM public.tds_deductees WHERE filing_id = tf.id) AS deductee_count,
    tf.acknowledgment_number,
    tf.date_of_filing,
    tf.work_status
  FROM public.tds_filings tf
)
DELETE FROM public.tds_filings
WHERE id IN (
  SELECT id FROM ranked
  WHERE rn > 1
    AND challan_count = 0
    AND deductee_count = 0
    AND acknowledgment_number IS NULL
    AND date_of_filing IS NULL
    AND work_status IN ('Not Started', 'Not Applicable')
);
