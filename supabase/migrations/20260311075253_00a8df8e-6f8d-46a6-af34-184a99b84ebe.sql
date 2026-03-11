
-- Create fa_financial_statements table
CREATE TABLE IF NOT EXISTS fa_financial_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES audit_engagements(id) NOT NULL,
  section text NOT NULL,
  line_item_code varchar(20),
  line_item_name varchar(200) NOT NULL,
  note_ref integer,
  schedule_ref varchar(50),
  amount_cy numeric DEFAULT 0,
  amount_py numeric,
  is_manual boolean DEFAULT false,
  override_reason text,
  source text DEFAULT 'tb_mapped',
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE fa_financial_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_select" ON fa_financial_statements FOR SELECT TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "fs_insert" ON fa_financial_statements FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "fs_update" ON fa_financial_statements FOR UPDATE TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));
CREATE POLICY "fs_delete" ON fa_financial_statements FOR DELETE TO authenticated
  USING (is_superadmin() OR engagement_id IN (SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()));

CREATE INDEX IF NOT EXISTS idx_fs_engagement ON fa_financial_statements(engagement_id);
CREATE INDEX IF NOT EXISTS idx_fs_section ON fa_financial_statements(section);

-- Add coa_mapping JSONB to audit_engagements to store account-to-FS mappings
ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS coa_mapping jsonb DEFAULT '{}';
