
-- Add columns to trial_balance_snapshots
ALTER TABLE trial_balance_snapshots
  ADD COLUMN IF NOT EXISTS import_format text DEFAULT 'generic_excel',
  ADD COLUMN IF NOT EXISTS column_mapping jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS debit_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difference numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_validated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS chunk_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunks_processed integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_id uuid REFERENCES audit_engagements(id);

-- Create ledger_import_batches
CREATE TABLE IF NOT EXISTS ledger_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES audit_engagements(id) NOT NULL,
  file_url text,
  original_filename text,
  file_size_bytes integer,
  row_count integer DEFAULT 0,
  processing_status text DEFAULT 'uploading',
  error_log jsonb DEFAULT '[]',
  imported_by uuid,
  imported_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ledger_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lib_select" ON ledger_import_batches FOR SELECT TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "lib_insert" ON ledger_import_batches FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "lib_update" ON ledger_import_batches FOR UPDATE TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "lib_delete" ON ledger_import_batches FOR DELETE TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));

-- Create ledger_transactions
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES audit_engagements(id) NOT NULL,
  account_name text NOT NULL,
  account_group text,
  date date,
  voucher_type varchar(100),
  voucher_no varchar(100),
  narration text,
  debit numeric DEFAULT 0,
  credit numeric DEFAULT 0,
  running_balance numeric DEFAULT 0,
  import_batch_id uuid REFERENCES ledger_import_batches(id),
  scrutiny_flag boolean DEFAULT false,
  flag_reason text,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lt_select" ON ledger_transactions FOR SELECT TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "lt_insert" ON ledger_transactions FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "lt_update" ON ledger_transactions FOR UPDATE TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "lt_delete" ON ledger_transactions FOR DELETE TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lt_engagement ON ledger_transactions(engagement_id);
CREATE INDEX IF NOT EXISTS idx_lt_account ON ledger_transactions(account_name);
CREATE INDEX IF NOT EXISTS idx_lt_flag ON ledger_transactions(scrutiny_flag) WHERE scrutiny_flag = true;
CREATE INDEX IF NOT EXISTS idx_tbs_engagement ON trial_balance_snapshots(engagement_id);
