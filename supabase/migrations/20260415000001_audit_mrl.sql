-- Migration: audit_mrl
-- Management Representation Letter clauses per SA 580
-- Corporate entities only (enforced at application layer)

CREATE TABLE IF NOT EXISTS audit_mrl (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   uuid        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  clause_number   int         NOT NULL,
  clause_title    text        NOT NULL,
  clause_text     text        NOT NULL DEFAULT '',
  is_selected     boolean     NOT NULL DEFAULT true,
  custom_remarks  text,
  last_updated_at timestamptz DEFAULT now(),
  last_updated_by uuid,
  UNIQUE (engagement_id, clause_number)
);

ALTER TABLE audit_mrl ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their engagement MRL"
  ON audit_mrl
  FOR ALL
  USING (
    engagement_id IN (
      SELECT id FROM audit_engagements
      WHERE firm_id IN (
        SELECT firm_id FROM users WHERE id = auth.uid()
      )
    )
  );
