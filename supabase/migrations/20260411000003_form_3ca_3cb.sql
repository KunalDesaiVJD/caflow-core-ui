-- ─── form_3ca_3cb ────────────────────────────────────────────────────────────
-- Stores draft data for Form 3CA and Form 3CB (one row per engagement per tab).
-- All editable field values are stored as jsonb in the `data` column.
-- Auto-filled fields (client name, firm details) are NOT stored here —
-- they are always fetched live from audit_engagements / clients / audit_firms.

CREATE TABLE IF NOT EXISTS form_3ca_3cb (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  firm_id       uuid        NOT NULL REFERENCES firms(id)             ON DELETE CASCADE,
  client_id     uuid        REFERENCES clients(id),
  tab           text        NOT NULL CHECK (tab IN ('3ca', '3cb')),
  data          jsonb       NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'complete', 'locked')),
  last_saved_at timestamptz,
  last_saved_by uuid        REFERENCES users(id),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (engagement_id, tab)
);

CREATE INDEX IF NOT EXISTS form_3ca_3cb_engagement_idx
  ON form_3ca_3cb (engagement_id, tab);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE form_3ca_3cb ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON form_3ca_3cb FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON form_3ca_3cb FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_update" ON form_3ca_3cb FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());
