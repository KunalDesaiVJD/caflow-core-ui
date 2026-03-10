-- Create ITR work groups table
CREATE TABLE IF NOT EXISTS itr_work_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code IN ('A','B','C','D')),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  UNIQUE(firm_id, code)
);

-- Add new columns to itr_profiles
ALTER TABLE itr_profiles
  ADD COLUMN IF NOT EXISTS itr_work_group_id UUID REFERENCES itr_work_groups(id),
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS date_data_received DATE,
  ADD COLUMN IF NOT EXISTS date_filed DATE,
  ADD COLUMN IF NOT EXISTS acknowledgment_no TEXT,
  ADD COLUMN IF NOT EXISTS assessment_year TEXT;

-- RLS for itr_work_groups
ALTER TABLE itr_work_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON itr_work_groups
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON itr_work_groups
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_update" ON itr_work_groups
  FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_delete" ON itr_work_groups
  FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());