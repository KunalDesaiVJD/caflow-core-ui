-- ─────────────────────────────────────────────────────────────────────────
-- Receipts: allow TDS-only entries.
--
-- A client can deduct TDS (or GST TDS) without paying anything on that date.
-- The firm records the TDS against the client's outstanding on its own, and
-- the receipt amount is not compulsory.
--
--   1. billing_receipts previously required amount_received > 0. It now needs
--      a receipt amount OR a TDS / GST TDS amount (never an all-zero row).
--   2. post_receipt() no longer writes a "receipt" ledger row for a zero
--      amount — only the TDS / GST TDS adjustment rows — and falls back to
--      payment mode 'other' (the column is NOT NULL with a fixed list).
--
-- Invoice settlement already counts TDS: recalc_invoice_paid_for() sums
-- amount_received + tds_amount + gst_tds_amount, so a TDS-only entry reduces
-- the invoice's amount due like any other receipt.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.billing_receipts DROP CONSTRAINT IF EXISTS chk_receipts_amount_positive;
ALTER TABLE public.billing_receipts DROP CONSTRAINT IF EXISTS chk_receipts_amount_or_tds;
ALTER TABLE public.billing_receipts ADD CONSTRAINT chk_receipts_amount_or_tds CHECK (
  amount_received > 0
  OR (amount_received = 0 AND COALESCE(tds_amount, 0) + COALESCE(gst_tds_amount, 0) > 0)
);

CREATE OR REPLACE FUNCTION public.post_receipt(p_firm_id uuid, p_client_id uuid, p_invoice_id uuid, p_receipt_type text, p_receipt_date date, p_amount numeric, p_payment_mode text, p_payment_reference text, p_tds numeric, p_gst_tds numeric, p_tds_date date, p_remarks text, p_gstin text, p_created_by uuid, p_financial_year text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_receipt_id uuid;
BEGIN
  IF COALESCE(p_amount, 0) <= 0 AND COALESCE(p_tds, 0) + COALESCE(p_gst_tds, 0) <= 0 THEN
    RAISE EXCEPTION 'Enter a receipt amount or a TDS / GST TDS amount';
  END IF;
  INSERT INTO billing_receipts (firm_id, client_id, invoice_id, receipt_type, receipt_date, amount_received, payment_mode, payment_reference, tds_amount, gst_tds_amount, tds_date, remarks, gstin, created_by)
  VALUES (p_firm_id, p_client_id, p_invoice_id, p_receipt_type, p_receipt_date, COALESCE(p_amount, 0), lower(COALESCE(NULLIF(p_payment_mode, ''), 'other')), p_payment_reference, NULLIF(p_tds,0), NULLIF(p_gst_tds,0), p_tds_date, p_remarks, p_gstin, p_created_by)
  RETURNING id INTO v_receipt_id;
  -- No receipt row for a TDS-only entry; the TDS rows below carry it.
  IF COALESCE(p_amount, 0) > 0 THEN
    INSERT INTO client_ledger_entries (firm_id, client_id, entry_date, entry_type, document_id, debit_amount, credit_amount, narration, financial_year)
    VALUES (p_firm_id, p_client_id, p_receipt_date, 'receipt', v_receipt_id, 0, p_amount, 'Payment received — ' || COALESCE(p_payment_mode,''), p_financial_year);
  END IF;
  IF COALESCE(p_tds,0) > 0 THEN INSERT INTO client_ledger_entries (firm_id, client_id, entry_date, entry_type, document_id, debit_amount, credit_amount, narration, financial_year) VALUES (p_firm_id, p_client_id, p_receipt_date, 'adjustment', v_receipt_id, 0, p_tds, 'TDS deducted', p_financial_year); END IF;
  IF COALESCE(p_gst_tds,0) > 0 THEN INSERT INTO client_ledger_entries (firm_id, client_id, entry_date, entry_type, document_id, debit_amount, credit_amount, narration, financial_year) VALUES (p_firm_id, p_client_id, p_receipt_date, 'adjustment', v_receipt_id, 0, p_gst_tds, 'GST TDS deducted', p_financial_year); END IF;
  IF p_invoice_id IS NOT NULL AND p_receipt_type = 'against_invoice' THEN
    UPDATE invoices SET status = 'paid', paid_at = p_receipt_date WHERE id = p_invoice_id AND COALESCE(amount_due, 0) <= 0.005 AND status NOT IN ('voided','draft');
  END IF;
  RETURN v_receipt_id;
END $function$;
