-- Migration 3: FY-wise audit setup table

CREATE TABLE client_fy_audit_setup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  statutory_audit_applicable boolean NOT NULL DEFAULT false,
  tax_audit_applicable boolean NOT NULL DEFAULT false,
  caro_applicable boolean NOT NULL DEFAULT false,
  internal_audit_applicable boolean NOT NULL DEFAULT false,
  stock_audit_applicable boolean NOT NULL DEFAULT false,
  audit_billing_amount numeric(12,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_id, financial_year)
);

ALTER TABLE client_fy_audit_setup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_select_fy_audit_setup" ON client_fy_audit_setup
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_insert_fy_audit_setup" ON client_fy_audit_setup
  FOR INSERT TO authenticated
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_update_fy_audit_setup" ON client_fy_audit_setup
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_delete_fy_audit_setup" ON client_fy_audit_setup
  FOR DELETE TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));
