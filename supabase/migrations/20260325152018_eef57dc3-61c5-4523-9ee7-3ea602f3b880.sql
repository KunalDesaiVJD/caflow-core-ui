-- Migration 9: billing_receipts table

CREATE TABLE billing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  receipt_type text NOT NULL CHECK (receipt_type IN ('against_invoice', 'on_account')),
  receipt_date date NOT NULL,
  amount_received numeric(12,2) NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('cash','cheque','neft','upi','rtgs','other')),
  payment_reference text,
  tds_amount numeric(12,2) DEFAULT 0,
  gst_tds_amount numeric(12,2) DEFAULT 0,
  tds_date date,
  remarks text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE billing_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_select_billing_receipts" ON billing_receipts
  FOR SELECT TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_insert_billing_receipts" ON billing_receipts
  FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_update_billing_receipts" ON billing_receipts
  FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id())
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_delete_billing_receipts" ON billing_receipts
  FOR DELETE TO authenticated
  USING (firm_id = public.current_user_firm_id());
