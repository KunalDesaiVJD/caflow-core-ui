-- ────────────────────────────────────────────────────────────────────────────
-- Migration: nce_letters — Client Certificate & Management Letter (NCE Stage 8)
-- ────────────────────────────────────────────────────────────────────────────
-- One table stores both letter types for NCE (non-corporate entity) Stage 8.
-- Discriminated by letter_type:
--   'client_certificate' — Audit Certificate; has cash_on_hand, closing_stock fields
--   'management_letter'  — Management Representation Letter; no extra editable fields
--
-- One row per (engagement_id, financial_year, letter_type).
-- All statements are idempotent (IF NOT EXISTS) — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nce_letters (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       UUID        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  financial_year      TEXT        NOT NULL,
  letter_type         TEXT        NOT NULL
    CHECK (letter_type IN ('client_certificate', 'management_letter')),

  -- Date filled in by the user on both letter types
  letter_date         DATE,

  -- Client Certificate specific editable fields
  cash_on_hand        NUMERIC,    -- 'Cash on hand Rs. ______'
  closing_stock       NUMERIC,    -- 'Closing stock Rs. ______'
  closing_stock_date  DATE,       -- 'as on ______'

  -- Management Letter has no extra scalar fields;
  -- any clause overrides / selections are stored in the component's own state
  -- and persisted via the same row (no separate JSONB needed for MVP).

  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- One row per (engagement, financial_year, letter_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nce_letters
  ON nce_letters (engagement_id, financial_year, letter_type);

COMMENT ON TABLE nce_letters IS
  'Stores Client Certificate and Management Representation Letter data for NCE (non-corporate entity) engagements — Stage 8.';

ALTER TABLE nce_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "NCE letters — firm members only" ON nce_letters;
CREATE POLICY "NCE letters — firm members only"
  ON nce_letters
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

GRANT SELECT, INSERT, UPDATE, DELETE ON nce_letters TO anon, authenticated;
