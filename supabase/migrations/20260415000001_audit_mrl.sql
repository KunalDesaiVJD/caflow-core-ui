-- Migration: mrl_data
-- Management Representation Letter storage — one row per engagement (JSONB)
-- Corporate entities only (enforced at application layer)

-- Drop prior iteration if it was run
DROP TABLE IF EXISTS audit_mrl;

CREATE TABLE IF NOT EXISTS mrl_data (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   uuid        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  clauses_json    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  header_data     jsonb,
  updated_at      timestamptz DEFAULT now(),
  updated_by      uuid        REFERENCES auth.users(id),
  UNIQUE (engagement_id)
);

ALTER TABLE mrl_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their engagement MRL"
  ON mrl_data
  FOR ALL
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );
