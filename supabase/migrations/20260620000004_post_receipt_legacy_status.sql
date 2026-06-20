-- Phase 2 cutover — make post_receipt a COMPLETE settlement.
--
-- The amount_paid trigger already maintains amount_due / payment_status, but
-- many screens still read the legacy invoices.status field. So that the RPC
-- path behaves identically to today's client-side path (which flips status to
-- 'paid' on full payment), post_receipt now also sets status='paid' / paid_at
-- once the linked invoice is fully settled. Still SECURITY INVOKER (RLS
-- applies); still dormant until BILLING_RPC_RECEIPT_POSTING is flipped on.

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

  -- Legacy status: the amount_paid trigger has already updated amount_due above,
  -- so mark the linked invoice paid once it is fully settled (cash + TDS + GST-TDS).
  IF p_invoice_id IS NOT NULL AND p_receipt_type = 'against_invoice' THEN
    UPDATE invoices
       SET status = 'paid', paid_at = p_receipt_date
     WHERE id = p_invoice_id
       AND COALESCE(amount_due, 0) <= 0.005
       AND status NOT IN ('voided', 'draft');
  END IF;

  RETURN v_receipt_id;
END $$;
