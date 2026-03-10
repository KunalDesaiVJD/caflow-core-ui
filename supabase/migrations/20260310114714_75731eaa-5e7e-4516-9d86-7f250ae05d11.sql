
-- Notice Tracker tables
CREATE TABLE demand_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id UUID NOT NULL REFERENCES firms(id),
  notice_type TEXT CHECK (notice_type IN ('income_tax_demand_143_1','scrutiny_notice_143_2','deficiency_memo','gstn_notice','tds_mismatch_26as','roc_notice','pf_esic_notice','custom')),
  notice_ref_no TEXT,
  assessment_year TEXT,
  section TEXT,
  department TEXT,
  notice_date DATE,
  date_received DATE,
  amount_demanded NUMERIC(15,2),
  amount_disputed NUMERIC(15,2),
  reply_due_date DATE,
  extended_due_date DATE,
  assigned_to UUID REFERENCES users(id),
  priority TEXT DEFAULT 'Medium' CHECK (priority IN ('Critical','High','Medium','Low')),
  status TEXT DEFAULT 'Received' CHECK (status IN ('Received','Under Review','Reply Drafted','Reply Filed','Awaiting Order','Order Received','Closed/Dropped')),
  notice_document_r2_key TEXT,
  order_document_r2_key TEXT,
  ai_draft_reply TEXT,
  final_reply TEXT,
  remarks TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE demand_notice_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id UUID NOT NULL REFERENCES demand_notices(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT now(),
  change_note TEXT
);

-- RLS for demand_notices
ALTER TABLE demand_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON demand_notices FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON demand_notices FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_update" ON demand_notices FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_delete" ON demand_notices FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

-- RLS for demand_notice_status_history
ALTER TABLE demand_notice_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON demand_notice_status_history FOR SELECT TO authenticated
  USING (is_superadmin() OR notice_id IN (SELECT id FROM demand_notices WHERE firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_insert" ON demand_notice_status_history FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR notice_id IN (SELECT id FROM demand_notices WHERE firm_id = current_user_firm_id()));

-- Trigger to auto-log status changes
CREATE OR REPLACE FUNCTION log_notice_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO demand_notice_status_history (notice_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notice_status_change
  BEFORE UPDATE ON demand_notices
  FOR EACH ROW
  EXECUTE FUNCTION log_notice_status_change();
