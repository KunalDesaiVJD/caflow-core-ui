-- ─────────────────────────────────────────────────────────────────────────────
-- client_classification_history
-- Append-only log of every classification change per client per FY.
-- Old rows are NEVER updated — each reclassification inserts a new row so the
-- full audit trail is preserved.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_classification_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  financial_year  text        NOT NULL,
  classification  text        NOT NULL,
  changed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by client + FY (e.g. "show all changes for this client this year")
CREATE INDEX IF NOT EXISTS idx_cch_client_fy
  ON client_classification_history (client_id, financial_year);

-- Fast lookup by timestamp (e.g. "recent changes across all clients")
CREATE INDEX IF NOT EXISTS idx_cch_changed_at
  ON client_classification_history (changed_at DESC);

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE client_classification_history ENABLE ROW LEVEL SECURITY;

-- Firm members can view history for clients that belong to their firm
CREATE POLICY "firm_read_classification_history"
  ON client_classification_history FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients
      WHERE firm_id = (
        SELECT firm_id FROM users WHERE id = auth.uid() LIMIT 1
      )
    )
  );

-- Firm members can insert history entries for their firm's clients
CREATE POLICY "firm_insert_classification_history"
  ON client_classification_history FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients
      WHERE firm_id = (
        SELECT firm_id FROM users WHERE id = auth.uid() LIMIT 1
      )
    )
  );

-- Superadmin can do everything
CREATE POLICY "superadmin_all_classification_history"
  ON client_classification_history FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'superadmin')
  );
