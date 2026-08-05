-- 2026-08-07 — 194Q turnover-gate (Stage 6)
--
-- Section 194Q applies only when the BUYER's turnover in the immediately
-- preceding financial year exceeded ₹10 crore. This cannot be derived from
-- the Trial Balance alone (it needs the buyer's own PY financials, not the
-- client's own TB for the audit year). Per explicit user instruction, the
-- auditor is asked this ONE yes/no question before Run Reconciliation ever
-- computes a 194Q expected-TDS figure. Answering "No" (or leaving it
-- unset) means 194Q reconciliation is skipped entirely — the underlying
-- goods-purchase candidates still surface in Party Mapping for visibility,
-- but no rate/short-deduction flag is raised until this is confirmed Yes.

CREATE TABLE IF NOT EXISTS tds_194q_settings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id                 UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  financial_year          TEXT NOT NULL,
  turnover_exceeds_10cr   BOOLEAN NOT NULL,
  confirmed_by            TEXT,
  confirmed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tds_194q_settings_uniq UNIQUE (client_id, financial_year)
);

ALTER TABLE tds_194q_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tds_194q_settings_firm_read"  ON tds_194q_settings;
DROP POLICY IF EXISTS "tds_194q_settings_firm_write" ON tds_194q_settings;

CREATE POLICY "tds_194q_settings_firm_read"
  ON tds_194q_settings FOR SELECT
  USING (firm_id IN (SELECT users.firm_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "tds_194q_settings_firm_write"
  ON tds_194q_settings FOR ALL
  USING (firm_id IN (SELECT users.firm_id FROM users WHERE users.id = auth.uid()))
  WITH CHECK (firm_id IN (SELECT users.firm_id FROM users WHERE users.id = auth.uid()));

COMMENT ON TABLE tds_194q_settings IS
  'Auditor-confirmed answer to "did the buyer''s PY turnover exceed ₹10 crore?" '
  'per engagement + FY. Section 194Q reconciliation is skipped entirely when '
  'this is false or unset — only the goods-purchase candidate surfaces in '
  'Party Mapping, no rate flag is raised.';
