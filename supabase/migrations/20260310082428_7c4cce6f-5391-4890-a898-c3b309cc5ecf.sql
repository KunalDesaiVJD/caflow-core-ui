
CREATE TABLE IF NOT EXISTS client_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(firm_id, name)
);

CREATE TABLE IF NOT EXISTS client_group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES client_groups(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, client_id)
);

ALTER TABLE client_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON client_groups FOR SELECT TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_insert" ON client_groups FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_update" ON client_groups FOR UPDATE TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_delete" ON client_groups FOR DELETE TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

ALTER TABLE client_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON client_group_memberships FOR SELECT TO authenticated
  USING (is_superadmin() OR (group_id IN (SELECT id FROM client_groups WHERE firm_id = current_user_firm_id())));

CREATE POLICY "firm_scope_insert" ON client_group_memberships FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (group_id IN (SELECT id FROM client_groups WHERE firm_id = current_user_firm_id())));

CREATE POLICY "firm_scope_update" ON client_group_memberships FOR UPDATE TO authenticated
  USING (is_superadmin() OR (group_id IN (SELECT id FROM client_groups WHERE firm_id = current_user_firm_id())));

CREATE POLICY "firm_scope_delete" ON client_group_memberships FOR DELETE TO authenticated
  USING (is_superadmin() OR (group_id IN (SELECT id FROM client_groups WHERE firm_id = current_user_firm_id())));
