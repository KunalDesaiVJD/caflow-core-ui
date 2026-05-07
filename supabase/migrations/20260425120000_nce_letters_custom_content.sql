-- Add custom_content JSONB column to nce_letters
-- Stores per-paragraph text overrides for NCE Client Certificate and Management Letter.
-- NULL means "use application defaults"; set fields override specific paragraphs.
--
-- Guard: if nce_letters table doesn't exist yet on this environment
-- (e.g. 20260420000001_nce_letters.sql was skipped), create it first
-- so this migration is self-contained and idempotent.

CREATE TABLE IF NOT EXISTS nce_letters (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       UUID        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  financial_year      TEXT        NOT NULL,
  letter_type         TEXT        NOT NULL
    CHECK (letter_type IN ('client_certificate', 'management_letter')),
  letter_date         DATE,
  cash_on_hand        NUMERIC,
  closing_stock       NUMERIC,
  closing_stock_date  DATE,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nce_letters
  ON nce_letters (engagement_id, financial_year, letter_type);

ALTER TABLE nce_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "NCE letters — firm members only" ON nce_letters;
CREATE POLICY "NCE letters — firm members only"
  ON nce_letters FOR ALL
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON nce_letters TO anon, authenticated;

-- Now add the custom_content column (idempotent either way)
ALTER TABLE nce_letters
  ADD COLUMN IF NOT EXISTS custom_content jsonb;

COMMENT ON COLUMN nce_letters.custom_content IS
  'JSON map of overridden paragraph text for NCE letters.
   Client Certificate keys: para3..para9, closingLine.
   Management Letter keys: bodyPara, confirmLine.';
