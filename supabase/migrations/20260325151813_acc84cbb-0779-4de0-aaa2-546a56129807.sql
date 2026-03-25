-- Migration 6: client_service_packages table

CREATE TABLE client_service_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  package_name text NOT NULL,
  service_category_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  frequency text NOT NULL,
  reminder_date integer CHECK (reminder_date IS NULL OR (reminder_date >= 1 AND reminder_date <= 31)),
  billing_amount numeric(12,2),
  invoice_gen_type text NOT NULL DEFAULT 'reminder' CHECK (invoice_gen_type IN ('auto', 'reminder')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE client_service_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_select_service_packages" ON client_service_packages
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_insert_service_packages" ON client_service_packages
  FOR INSERT TO authenticated
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_update_service_packages" ON client_service_packages
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()))
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));

CREATE POLICY "firm_delete_service_packages" ON client_service_packages
  FOR DELETE TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE firm_id = public.current_user_firm_id()));
