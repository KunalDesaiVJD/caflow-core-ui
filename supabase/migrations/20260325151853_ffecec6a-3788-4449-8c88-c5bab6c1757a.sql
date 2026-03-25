-- Migration 7: Extend client_services table

ALTER TABLE client_services
  ADD COLUMN IF NOT EXISTS billing_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS reminder_date integer CHECK (reminder_date IS NULL OR (reminder_date >= 1 AND reminder_date <= 31)),
  ADD COLUMN IF NOT EXISTS invoice_gen_type text DEFAULT 'reminder' CHECK (invoice_gen_type IN ('auto', 'reminder')),
  ADD COLUMN IF NOT EXISTS billing_mode text DEFAULT 'service_specific' CHECK (billing_mode IN ('service_specific', 'package_wise'));

-- Copy existing fee_override values to billing_amount where billing_amount is null
UPDATE client_services SET billing_amount = fee_override WHERE billing_amount IS NULL AND fee_override IS NOT NULL;
