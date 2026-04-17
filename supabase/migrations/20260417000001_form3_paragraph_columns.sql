-- Add JSONB columns to store editable paragraph text for Form 3CA and 3CB
-- Each column stores a flat key→text map of all paragraph overrides.
-- If a key is absent the component falls back to the statutory template text.

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS form_3cb_paragraphs JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS form_3ca_paragraphs JSONB DEFAULT '{}'::jsonb;
