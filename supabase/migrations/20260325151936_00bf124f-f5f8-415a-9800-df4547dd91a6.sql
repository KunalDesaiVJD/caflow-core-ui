-- Migration 8: billing_reminders table

CREATE TABLE billing_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES firms(id),
  service_category_id uuid REFERENCES service_categories(id) ON DELETE SET NULL,
  package_id uuid REFERENCES client_service_packages(id) ON DELETE SET NULL,
  billing_amount numeric(12,2) NOT NULL,
  frequency text NOT NULL,
  reminder_date integer,
  next_due_date date,
  invoice_gen_type text NOT NULL DEFAULT 'reminder',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','notified','invoice_created','paid')),
  last_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE billing_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_select_billing_reminders" ON billing_reminders
  FOR SELECT TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_insert_billing_reminders" ON billing_reminders
  FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_update_billing_reminders" ON billing_reminders
  FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id())
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_delete_billing_reminders" ON billing_reminders
  FOR DELETE TO authenticated
  USING (firm_id = public.current_user_firm_id());
