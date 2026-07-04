-- 2026-06-25 — Billing document numbering fix (V J Desai & Co. LLP)
--
-- BUG (user report, June 2026):
--   • Documents list showed doc numbers out of order — e.g. 59 → 60 →
--     62 → 61 within the same date (60 was rendered ABOVE 62 even with
--     ORDER BY invoice_date DESC, seq_number DESC, because seq_number
--     was NULL on invoice #60 and Postgres sorts NULLs FIRST in DESC).
--   • "New Invoice" auto-suggested seq 60 even though invoices 60..64
--     already existed, because get_next_invoice_seq / allocate_doc_number
--     compute MAX(seq_number) which ignores rows with seq_number IS NULL.
--
-- ROOT CAUSE:
--   The client (src/pages/NewInvoice.tsx) sets `finalSeq = null` whenever
--   the auditor manually edited the invoice number (`docNoManual`). The
--   invoice is then persisted with seq_number = NULL but invoice_no
--   containing "60/2026-27". Every subsequent numbering call misses
--   that row and returns a stale, already-used seq.
--
-- FIX (this migration — DB layer, defensive):
--   (a) Backfill seq_number by parsing the leading integer out of
--       invoice_no for every existing row where seq_number IS NULL.
--       Uses a regex against a firm-and-year scoped SELECT so the
--       backfill is idempotent and safe to re-run.
--   (b) Update get_next_invoice_seq and allocate_doc_number so the
--       MAX(seq_number) calculation ALSO considers a parsed seq from
--       invoice_no when seq_number IS NULL. This makes the numbering
--       correct regardless of any future save path that forgets to
--       populate seq_number.
--   (c) Reseed the billing_doc_sequences counter table (used by the
--       atomic allocator) so its last_seq reflects the freshly
--       backfilled MAX.
--
-- Every firm / financial-year benefits automatically — the fix lives in
-- shared RPCs, not per-client overrides.

-- ─────────────────────────────────────────────────────────────────────
-- (a) Backfill seq_number from invoice_no on all NULL rows
-- ─────────────────────────────────────────────────────────────────────
UPDATE invoices
   SET seq_number = (regexp_match(invoice_no, '^\s*(\d+)'))[1]::integer
 WHERE seq_number IS NULL
   AND invoice_no ~ '^\s*\d+';

-- ─────────────────────────────────────────────────────────────────────
-- (b) get_next_invoice_seq — defensive against NULL seq_number
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_next_invoice_seq(
  p_firm_id uuid,
  p_series text,
  p_financial_year text,
  p_invoice_date date
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_date date;
  v_next_seq integer;
BEGIN
  -- Chronological guard (unchanged).
  SELECT MAX(invoice_date) INTO v_max_date
  FROM invoices
  WHERE firm_id = p_firm_id
    AND document_series = p_series
    AND financial_year = p_financial_year
    AND seq_number IS NOT NULL;

  IF v_max_date IS NOT NULL AND p_invoice_date < v_max_date THEN
    RAISE EXCEPTION 'BACKDATING_ERROR: Cannot create a document dated % because a document dated % already exists in this series. Dates must be chronological.',
      p_invoice_date, v_max_date;
  END IF;

  -- Effective seq = MAX of (a) stored seq_number, (b) the integer parsed
  -- out of invoice_no when seq_number IS NULL. Belt-and-braces against
  -- any save path that persists a manual invoice_no without populating
  -- seq_number.
  SELECT COALESCE(MAX(
    COALESCE(
      seq_number,
      NULLIF((regexp_match(invoice_no, '^\s*(\d+)'))[1], '')::integer
    )
  ), 0) + 1 INTO v_next_seq
  FROM invoices
  WHERE firm_id = p_firm_id
    AND document_series = p_series
    AND financial_year = p_financial_year;

  RETURN v_next_seq;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- (b′) allocate_doc_number — same defensive NULL-seq handling
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allocate_doc_number(
  p_firm_id uuid, p_series text, p_financial_year text, p_invoice_date date
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max_date date; v_next integer; v_existing_max integer;
BEGIN
  SELECT MAX(invoice_date) INTO v_max_date FROM invoices
   WHERE firm_id=p_firm_id AND document_series=p_series
     AND financial_year=p_financial_year AND seq_number IS NOT NULL;
  IF v_max_date IS NOT NULL AND p_invoice_date < v_max_date THEN
    RAISE EXCEPTION 'BACKDATING_ERROR: Cannot create a document dated % because a document dated % already exists in this series. Dates must be chronological.',
      p_invoice_date, v_max_date;
  END IF;

  INSERT INTO billing_doc_sequences (firm_id, document_series, financial_year, last_seq)
  VALUES (p_firm_id, p_series, p_financial_year, 1)
  ON CONFLICT (firm_id, document_series, financial_year)
  DO UPDATE SET last_seq = billing_doc_sequences.last_seq + 1
  RETURNING last_seq INTO v_next;

  -- Safety: consider parsed invoice_no seq too, not just stored seq_number.
  SELECT COALESCE(MAX(
    COALESCE(
      seq_number,
      NULLIF((regexp_match(invoice_no, '^\s*(\d+)'))[1], '')::integer
    )
  ), 0) INTO v_existing_max FROM invoices
   WHERE firm_id=p_firm_id AND document_series=p_series AND financial_year=p_financial_year;
  IF v_next <= v_existing_max THEN
    v_next := v_existing_max + 1;
    UPDATE billing_doc_sequences SET last_seq = v_next
     WHERE firm_id=p_firm_id AND document_series=p_series AND financial_year=p_financial_year;
  END IF;

  RETURN v_next;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- (c) Reseed billing_doc_sequences from freshly backfilled max
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO billing_doc_sequences (firm_id, document_series, financial_year, last_seq)
SELECT firm_id, document_series, financial_year, MAX(seq_number)
FROM invoices
WHERE seq_number IS NOT NULL AND firm_id IS NOT NULL
  AND document_series IS NOT NULL AND financial_year IS NOT NULL
GROUP BY firm_id, document_series, financial_year
ON CONFLICT (firm_id, document_series, financial_year)
DO UPDATE SET last_seq = GREATEST(billing_doc_sequences.last_seq, EXCLUDED.last_seq);
