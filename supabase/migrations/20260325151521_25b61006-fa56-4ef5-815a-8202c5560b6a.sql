-- Migration 2: FY-wise classification table

CREATE TABLE client_fy_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  financial_year text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('Audit', 'Non-Audit', 'Partner in Audited Firm', 'Not Applicable')),
  audit_firm_id uuid REFERENCES audit_firms(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_id, financial_year)
);

ALTER TABLE client_fy_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_select_fy_classifications" ON client_fy_classifications
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_insert_fy_classifications" ON client_fy_classifications
  FOR INSERT TO authenticated
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_update_fy_classifications" ON client_fy_classifications
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));
