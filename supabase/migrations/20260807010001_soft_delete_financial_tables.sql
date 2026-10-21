-- Soft-delete columns for irreplaceable client work-product tables.
--
-- These three tables were previously hard-deleted from the UI with no
-- recovery path (see PipelineStage3 "Reset & Re-map", Documents.tsx,
-- ClientDetail.tsx, PortalDocuments.tsx). This migration is purely
-- additive: it adds nullable deleted_at / deleted_by columns so future
-- "delete" actions can be recorded as soft-deletes instead. It does not
-- touch, drop, or backfill any existing data or column, and does not add
-- NOT NULL or a default that would change existing row behavior.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

ALTER TABLE nce_financial_notes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

ALTER TABLE fa_financial_statements
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);
