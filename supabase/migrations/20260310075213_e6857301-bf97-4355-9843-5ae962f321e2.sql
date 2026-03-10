
CREATE TABLE IF NOT EXISTS audit_firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icai_reg_no TEXT,
  partner_name TEXT,
  partner_icai_no TEXT,
  address TEXT,
  city TEXT,
  email TEXT,
  phone TEXT,
  logo_r2_key TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_auditor_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  audit_firm_id UUID NOT NULL REFERENCES audit_firms(id),
  appointed_date DATE,
  remarks TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, financial_year)
);

ALTER TABLE audit_engagements ADD COLUMN IF NOT EXISTS audit_firm_id UUID REFERENCES audit_firms(id);

ALTER TABLE audit_firms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_scope_select" ON audit_firms FOR SELECT TO authenticated USING (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "firm_scope_insert" ON audit_firms FOR INSERT TO authenticated WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "firm_scope_update" ON audit_firms FOR UPDATE TO authenticated USING (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "firm_scope_delete" ON audit_firms FOR DELETE TO authenticated USING (is_superadmin() OR firm_id = current_user_firm_id());

ALTER TABLE client_auditor_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_scope_select" ON client_auditor_assignments FOR SELECT TO authenticated USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "firm_scope_insert" ON client_auditor_assignments FOR INSERT TO authenticated WITH CHECK (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "firm_scope_update" ON client_auditor_assignments FOR UPDATE TO authenticated USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "firm_scope_delete" ON client_auditor_assignments FOR DELETE TO authenticated USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
