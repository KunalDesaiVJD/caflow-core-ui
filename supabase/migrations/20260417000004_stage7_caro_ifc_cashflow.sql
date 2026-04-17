-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Stage 7 / Block C support — CARO + IFC + Cash Flow + Classification
-- ────────────────────────────────────────────────────────────────────────────
-- Adds:
--   1. Block C applicability columns on `audit_engagements`
--      (caro_applicable already exists; only ifc_applicable + cash_flow_applicable
--       are added here).
--   2. `stage7_ifc_data`         — Annexure-B (IFC) per-engagement storage
--   3. `stage7_cashflow_data`    — Cash Flow Statement summary numbers
--   4. `client_classification_history` — append-only audit log of every
--                                        classification change with
--                                        effective_from_fy semantics.
--
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE) so the migration
-- is safe to re-run.

-- ── 1. Block C columns on audit_engagements ───────────────────────────────
ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS ifc_applicable      boolean,
  ADD COLUMN IF NOT EXISTS cash_flow_applicable boolean;

COMMENT ON COLUMN audit_engagements.ifc_applicable IS
  'Stage 1 Block C — Internal Financial Controls report (Sec 143(3)(i)) applies to this engagement. NULL means inherited / not asked.';
COMMENT ON COLUMN audit_engagements.cash_flow_applicable IS
  'Stage 1 Block C — Cash Flow Statement (Sec 2(40)) applies to this engagement. NULL means inherited / not asked.';

-- ── 2. stage7_ifc_data ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stage7_ifc_data (
  engagement_id   uuid        PRIMARY KEY REFERENCES audit_engagements(id) ON DELETE CASCADE,
  sections        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  place           text,
  report_date     date,
  last_updated_at timestamptz DEFAULT now(),
  last_updated_by uuid        REFERENCES auth.users(id)
);

ALTER TABLE stage7_ifc_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their engagement IFC data" ON stage7_ifc_data;
CREATE POLICY "Users can manage their engagement IFC data"
  ON stage7_ifc_data
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

-- ── 3. stage7_cashflow_data ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stage7_cashflow_data (
  engagement_id    uuid        PRIMARY KEY REFERENCES audit_engagements(id) ON DELETE CASCADE,
  opening_balance  numeric,
  closing_balance  numeric,
  net_operating    numeric,
  net_investing    numeric,
  net_financing    numeric,
  disclosure_notes text,
  last_updated_at  timestamptz DEFAULT now(),
  last_updated_by  uuid        REFERENCES auth.users(id)
);

ALTER TABLE stage7_cashflow_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their engagement CashFlow data" ON stage7_cashflow_data;
CREATE POLICY "Users can manage their engagement CashFlow data"
  ON stage7_cashflow_data
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

-- ── 4. client_classification_history ──────────────────────────────────────
-- Append-only log: every classification change ever recorded for a client.
-- `effective_from_fy` is the FY when the new classification first applies
-- (Indian "YYYY-YY" string). `getClassificationForFY()` resolves the right
-- row by picking the most recent transition with effective_from_fy <=
-- targetFY.
CREATE TABLE IF NOT EXISTS client_classification_history (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  previous_classification text,
  new_classification  text        NOT NULL,
  effective_from_fy   text        NOT NULL,
  responsible_person  text,
  notes               text,
  changed_by          uuid        REFERENCES auth.users(id),
  changed_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cch_client_fy
  ON client_classification_history (client_id, effective_from_fy DESC);

ALTER TABLE client_classification_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage classification history for their firm clients"
  ON client_classification_history;
CREATE POLICY "Users can manage classification history for their firm clients"
  ON client_classification_history
  FOR ALL
  USING (
    client_id IN (
      SELECT c.id FROM clients c
      WHERE c.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT c.id FROM clients c
      WHERE c.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );
