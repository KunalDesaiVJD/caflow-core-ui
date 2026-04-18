-- Add sign-off / metadata columns for Form 3CA and 3CB to audit_engagements.
-- form_3cb_paragraphs and form_3ca_paragraphs already exist (20260417000001).

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS form_3cb_signature_date  TEXT,
  ADD COLUMN IF NOT EXISTS form_3cb_udin             TEXT,
  ADD COLUMN IF NOT EXISTS form_3ca_signature_date  TEXT,
  ADD COLUMN IF NOT EXISTS form_3ca_udin             TEXT,
  ADD COLUMN IF NOT EXISTS form_3ca_applicable_act  TEXT,
  ADD COLUMN IF NOT EXISTS form_3ca_act_other_text  TEXT,
  ADD COLUMN IF NOT EXISTS form_3ca_report_date     TEXT;
