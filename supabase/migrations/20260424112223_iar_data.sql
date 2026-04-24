-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Stage 8 IAR (Independent Auditor's Report) per-engagement data
-- ────────────────────────────────────────────────────────────────────────────
-- Adds a single table `iar_data` that holds the editable IAR state for each
-- engagement. Auto-derivable fragments (opinion paragraph templates, Annexure
-- references, etc.) continue to be generated on-the-fly by
-- `src/lib/auditReportGenerator.ts` from the Block C flags on
-- `audit_engagements` — only the auditor-editable fields are persisted here:
--
--   - opinion_type        : unmodified | qualified | adverse | disclaimer
--   - qualification_para  : free-text paragraph (shown only for qualified/adverse/disclaimer)
--   - emphasis_toggle     : whether "Emphasis of Matter" paragraph appears
--   - emphasis_text       : free-text paragraph
--   - kam_toggle          : whether "Key Audit Matters" section appears (listed companies only)
--   - kam_text            : free-text content
--   - branch_text         : branch-office disclosure sentence (pre-filled default)
--   - going_concern_std   : whether the standard going-concern sentence applies
--   - going_concern_text  : free-text override
--   - audit_trail_text    : Section 143(3)(g) audit-trail sentence (pre-filled default)
--   - litigation_rows     : JSONB rows for the litigation-matters annexure (3 blank rows by default)
--
-- All statements are idempotent (IF NOT EXISTS, DROP POLICY IF EXISTS) so the
-- migration is safe to re-run.

-- ── iar_data ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iar_data (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       uuid        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  opinion_type        text        NOT NULL DEFAULT 'unmodified'
                                  CHECK (opinion_type IN ('unmodified','qualified','adverse','disclaimer')),
  qualification_para  text,
  emphasis_toggle     boolean     DEFAULT false,
  emphasis_text       text,
  kam_toggle          boolean     DEFAULT false,
  kam_text            text,
  branch_text         text        DEFAULT 'The company does not have any branch, this para is not applicable.',
  going_concern_std   boolean     DEFAULT true,
  going_concern_text  text,
  audit_trail_text    text        DEFAULT 'the Company has used accounting software for maintaining its books of account, which has a feature of recording audit trail (edit log) facility and as informed by the management the same has operated throughout the year for all relevant transactions recorded in the software.',
  litigation_rows     jsonb       DEFAULT '[{"sr":1,"statute":"","amount":"","fy":"","forum":""},{"sr":2,"statute":"","amount":"","fy":"","forum":""},{"sr":3,"statute":"","amount":"","fy":"","forum":""}]'::jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (engagement_id)
);

COMMENT ON TABLE iar_data IS
  'Stage 8 — per-engagement editable state for the Independent Auditor''s Report. One row per audit_engagements row. Non-editable conditional paragraphs are generated from audit_engagements Block C flags via src/lib/auditReportGenerator.ts.';

-- Keep updated_at fresh on any change
CREATE OR REPLACE FUNCTION iar_data_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iar_data_set_updated_at ON iar_data;
CREATE TRIGGER trg_iar_data_set_updated_at
  BEFORE UPDATE ON iar_data
  FOR EACH ROW EXECUTE FUNCTION iar_data_set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────
-- Scope: an engagement's IAR row is visible/writable to any user whose
-- users.firm_id matches the engagement's firm_id. This matches the pattern
-- used by stage7_ifc_data, stage7_cashflow_data, audit_caro_responses, etc.
ALTER TABLE iar_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their engagement IAR data" ON iar_data;
CREATE POLICY "Users can manage their engagement IAR data"
  ON iar_data
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
