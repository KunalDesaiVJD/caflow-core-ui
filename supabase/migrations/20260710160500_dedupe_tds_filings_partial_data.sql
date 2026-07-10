-- Follow-up to 20260710160000: two duplicate groups survived the first pass
-- because both sibling rows had zero challans (the ranking tiebreak on that
-- migration didn't consider ack_number/date_of_filing/work_status, so a
-- fully-empty row could tie-break ahead of a row carrying partial data).
--
-- Deletes a duplicate row only when it is fully empty (no challans, no
-- deductees, no ack number, no filing date, status Not Started/Not
-- Applicable) AND at least one sibling in the same group carries some real
-- data (ack number, filing date, a non-default status, or challans/deductees)
-- — i.e. only removes a row that is strictly redundant next to a sibling
-- that already captures everything it would have.

WITH group_has_data AS (
  SELECT client_id, financial_year, quarter, tds_forms,
    bool_or(
      acknowledgment_number IS NOT NULL
      OR date_of_filing IS NOT NULL
      OR work_status NOT IN ('Not Started', 'Not Applicable')
      OR (SELECT COUNT(*) FROM public.tds_challans WHERE filing_id = tf.id) > 0
      OR (SELECT COUNT(*) FROM public.tds_deductees WHERE filing_id = tf.id) > 0
    ) AS has_data
  FROM public.tds_filings tf
  GROUP BY client_id, financial_year, quarter, tds_forms
  HAVING COUNT(*) > 1
)
DELETE FROM public.tds_filings tf
USING group_has_data g
WHERE tf.client_id = g.client_id
  AND tf.financial_year = g.financial_year
  AND tf.quarter = g.quarter
  AND tf.tds_forms = g.tds_forms
  AND g.has_data = true
  AND tf.acknowledgment_number IS NULL
  AND tf.date_of_filing IS NULL
  AND tf.work_status IN ('Not Started', 'Not Applicable')
  AND (SELECT COUNT(*) FROM public.tds_challans WHERE filing_id = tf.id) = 0
  AND (SELECT COUNT(*) FROM public.tds_deductees WHERE filing_id = tf.id) = 0;
