-- Migration 1: New columns on clients table

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tan_number text,
  ADD COLUMN IF NOT EXISTS dsc_number text,
  ADD COLUMN IF NOT EXISTS dsc_expiry_date date,
  ADD COLUMN IF NOT EXISTS work_group_type text,
  ADD COLUMN IF NOT EXISTS responsible_person_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE clients
  ADD CONSTRAINT clients_work_group_type_check
  CHECK (work_group_type IN ('only_itr', 'itr_with_accounts_inside', 'itr_with_accounts_outside'));

-- Data fixes
UPDATE clients SET statutory_audit_applicable = false WHERE statutory_audit_applicable IS NULL;
UPDATE clients SET caro_applicable = false WHERE caro_applicable IS NULL;
UPDATE clients SET internal_audit_applicable = false WHERE internal_audit_applicable IS NULL;
UPDATE clients SET stock_audit_applicable = false WHERE stock_audit_applicable IS NULL;

-- Unique index on (pan, firm_id) where pan is not null and deleted_at is null
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_pan_firm_unique
  ON clients (pan, firm_id)
  WHERE pan IS NOT NULL AND deleted_at IS NULL;

-- Unique constraint on client_profiles(client_id)
ALTER TABLE client_profiles
  ADD CONSTRAINT client_profiles_client_id_unique UNIQUE (client_id);
