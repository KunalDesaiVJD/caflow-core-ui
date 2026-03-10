
CREATE TABLE IF NOT EXISTS tds_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  quarter TEXT NOT NULL,
  tds_forms TEXT[] DEFAULT '{}',
  date_data_received DATE,
  preparer_id UUID REFERENCES users(id),
  checker_id UUID REFERENCES users(id),
  approver_id UUID REFERENCES users(id),
  work_status TEXT NOT NULL DEFAULT 'Data Received',
  date_of_filing DATE,
  acknowledgment_number TEXT,
  remarks TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tds_entries ADD COLUMN IF NOT EXISTS tds_filing_id UUID REFERENCES tds_filings(id);

ALTER TABLE tds_filings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON tds_filings FOR SELECT TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_insert" ON tds_filings FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_update" ON tds_filings FOR UPDATE TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_delete" ON tds_filings FOR DELETE TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));
