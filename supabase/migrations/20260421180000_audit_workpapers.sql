-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: audit_workpapers table
-- Stores workpaper / audit program entries for each engagement.
-- Referenced by: AuditIntelligence metrics, EngagementFieldwork, EngagementReviewSignoff
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_workpapers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID        REFERENCES audit_engagements(id) ON DELETE CASCADE,
  wp_ref        TEXT,         -- e.g. "WP-1", "WP-B2"
  section       TEXT,         -- e.g. "Revenue", "Fixed Assets"
  objective     TEXT,
  procedure     TEXT,
  conclusion    TEXT,
  signed_by     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_workpapers_engagement
  ON audit_workpapers (engagement_id);

ALTER TABLE audit_workpapers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_workpapers_firm_policy" ON audit_workpapers;
CREATE POLICY "audit_workpapers_firm_policy"
  ON audit_workpapers
  FOR ALL
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_workpapers TO anon, authenticated;
