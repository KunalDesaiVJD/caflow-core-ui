-- Migration: notes_to_accounts_data
-- NCE (Non-Corporate Entity) Notes to Accounts storage — one row per engagement (JSONB)
-- Non-corporate entities only (enforced at application layer)

CREATE TABLE IF NOT EXISTS notes_to_accounts_data (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id             uuid        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  notes_json                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  note3_variant             text        NOT NULL DEFAULT 'none',
  note1_new_entity_enabled  boolean     NOT NULL DEFAULT false,
  note1_new_entity_text     text,
  header_overrides          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  signature_data            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at                timestamptz DEFAULT now(),
  updated_by                uuid        REFERENCES auth.users(id),
  UNIQUE (engagement_id)
);

ALTER TABLE notes_to_accounts_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their engagement NCE notes"
  ON notes_to_accounts_data
  FOR ALL
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );
