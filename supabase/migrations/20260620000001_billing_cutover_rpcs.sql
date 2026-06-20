-- Phase 2 cutover — transactional posting RPCs. Additive and SAFE: these
-- objects are not used by the app until the matching billingFlags.ts flag is
-- flipped on (after a parity check). Existing behaviour is unchanged.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Atomic, monotonic document numbering (audit C8)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_doc_sequences (
  firm_id         uuid    NOT NULL,
  document_series text    NOT NULL,
  financial_year  text    NOT NULL,
  last_seq        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (firm_id, document_series, financial_year)
);

-- Seed the counter from existing invoices so the first allocation continues
-- the series (never restarts at 1, never reuses a number).
INSERT INTO billing_doc_sequences (firm_id, document_series, financial_year, last_seq)
SELECT firm_id, document_series, financial_year, MAX(seq_number)
FROM invoices
WHERE seq_number IS NOT NULL AND firm_id IS NOT NULL
  AND document_series IS NOT NULL AND financial_year IS NOT NULL
GROUP BY firm_id, document_series, financial_year
ON CONFLICT (firm_id, document_series, financial_year)
DO UPDATE SET last_seq = GREATEST(billing_doc_sequences.last_seq, EXCLUDED.last_seq);

-- Allocate the next number atomically (single locked upsert). Keeps the same
-- chronological backdating guard as get_next_invoice_seq.
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

  -- Safety: if the counter ever lags behind a real invoice (e.g. a manually
  -- numbered doc), jump past the existing max so we never return a duplicate.
  SELECT COALESCE(MAX(seq_number),0) INTO v_existing_max FROM invoices
   WHERE firm_id=p_firm_id AND document_series=p_series AND financial_year=p_financial_year;
  IF v_next <= v_existing_max THEN
    v_next := v_existing_max + 1;
    UPDATE billing_doc_sequences SET last_seq = v_next
     WHERE firm_id=p_firm_id AND document_series=p_series AND financial_year=p_financial_year;
  END IF;

  RETURN v_next;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Transactional receipt posting (audit H1) — receipt + ledger rows in one
--    atomic call. The amount_paid trigger then settles the invoice. RLS still
--    applies (SECURITY INVOKER), exactly like the current client-side writes.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_receipt(
  p_firm_id uuid, p_client_id uuid, p_invoice_id uuid, p_receipt_type text,
  p_receipt_date date, p_amount numeric, p_payment_mode text, p_payment_reference text,
  p_tds numeric, p_gst_tds numeric, p_tds_date date, p_remarks text, p_gstin text,
  p_created_by uuid, p_financial_year text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_receipt_id uuid;
BEGIN
  INSERT INTO billing_receipts (firm_id, client_id, invoice_id, receipt_type, receipt_date,
    amount_received, payment_mode, payment_reference, tds_amount, gst_tds_amount, tds_date,
    remarks, gstin, created_by)
  VALUES (p_firm_id, p_client_id, p_invoice_id, p_receipt_type, p_receipt_date,
    p_amount, lower(p_payment_mode), p_payment_reference, NULLIF(p_tds,0), NULLIF(p_gst_tds,0),
    p_tds_date, p_remarks, p_gstin, p_created_by)
  RETURNING id INTO v_receipt_id;

  INSERT INTO client_ledger_entries (firm_id, client_id, entry_date, entry_type, document_id,
    debit_amount, credit_amount, narration, financial_year)
  VALUES (p_firm_id, p_client_id, p_receipt_date, 'receipt', v_receipt_id, 0, p_amount,
    'Payment received — ' || COALESCE(p_payment_mode,''), p_financial_year);

  IF COALESCE(p_tds,0) > 0 THEN
    INSERT INTO client_ledger_entries (firm_id, client_id, entry_date, entry_type, document_id,
      debit_amount, credit_amount, narration, financial_year)
    VALUES (p_firm_id, p_client_id, p_receipt_date, 'adjustment', v_receipt_id, 0, p_tds,
      'TDS deducted', p_financial_year);
  END IF;

  IF COALESCE(p_gst_tds,0) > 0 THEN
    INSERT INTO client_ledger_entries (firm_id, client_id, entry_date, entry_type, document_id,
      debit_amount, credit_amount, narration, financial_year)
    VALUES (p_firm_id, p_client_id, p_receipt_date, 'adjustment', v_receipt_id, 0, p_gst_tds,
      'GST TDS deducted', p_financial_year);
  END IF;

  RETURN v_receipt_id;
END $$;
