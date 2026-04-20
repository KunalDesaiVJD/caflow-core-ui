-- ─────────────────────────────────────────────────────────────────────────────
-- Enrich client_classification_history with audit-trail columns
-- The original migration only captured: client_id, financial_year, classification,
-- changed_by, changed_at.  The wizard/timeline UI expects several additional
-- columns; add them as NULLable so existing rows remain valid.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE client_classification_history
  ADD COLUMN IF NOT EXISTS old_classification   text,
  ADD COLUMN IF NOT EXISTS new_classification   text,
  ADD COLUMN IF NOT EXISTS effective_from_fy    text,
  ADD COLUMN IF NOT EXISTS responsible_person_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes                text;
