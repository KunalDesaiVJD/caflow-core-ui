-- ═══════════════════════════════════════════════════════════════════════════
-- CAFlow — Tally XML Ingestion Tables
-- Migration: 20260402120000_tally_xml_ingestion
--
-- Creates 3 new tables (do NOT conflict with existing tables):
--   1. tally_xml_uploads      — one record per uploaded XML file
--   2. tally_tb_rows          — one record per parsed + normalized TB row
--   3. tally_processing_logs  — per-event audit log for each upload
--
-- Design rules:
--   • Raw values are ALWAYS preserved unchanged
--   • Normalized values are computed and stored separately
--   • All reporting must use normalized columns
--   • sign_rule_applied records which normalization was applied (audit trail)
--   • ON DELETE CASCADE ensures cleanup: delete upload → all rows + logs deleted
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. tally_xml_uploads ───────────────────────────────────────────────────
-- Tracks every XML file upload: status, metadata, and optionally the raw XML.

CREATE TABLE IF NOT EXISTS public.tally_xml_uploads (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     TEXT        NOT NULL,
  -- raw_xml is nullable — set SKIP_RAW_XML_STORAGE=true in .env to omit storage
  raw_xml       TEXT        NULL,
  parse_status  TEXT        NOT NULL DEFAULT 'processing'
                            CHECK (parse_status IN ('processing', 'completed', 'failed')),
  total_rows    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.tally_xml_uploads IS 'One record per Tally XML trial balance file upload';
COMMENT ON COLUMN public.tally_xml_uploads.raw_xml      IS 'Full raw XML as received — never modified';
COMMENT ON COLUMN public.tally_xml_uploads.parse_status IS 'processing | completed | failed';
COMMENT ON COLUMN public.tally_xml_uploads.total_rows   IS 'Number of rows successfully processed and stored';

-- ─── 2. tally_tb_rows ───────────────────────────────────────────────────────
-- One row per ledger/group found in the XML.
-- Stores BOTH raw values (as-is from XML) AND normalized values (sign-corrected).
-- NEVER overwrite or update raw_* columns after insert.

CREATE TABLE IF NOT EXISTS public.tally_tb_rows (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id     UUID        NOT NULL
                            REFERENCES public.tally_xml_uploads(id) ON DELETE CASCADE,

  -- ── Identity ────────────────────────────────────────────────────────────
  display_name      TEXT    NOT NULL,
  account_category  TEXT    NOT NULL DEFAULT 'unknown'
                            CHECK (account_category IN (
                              'asset', 'liability', 'capital', 'income', 'expense', 'unknown'
                            )),

  -- ── Raw values: EXACTLY as extracted from XML ────────────────────────────
  -- RULE: These columns must NEVER be modified after insert.
  -- RULE: Do NOT use these for any UI output or financial reports.
  opening_balance_raw   NUMERIC(18, 4) NOT NULL DEFAULT 0,
  debit_raw             NUMERIC(18, 4) NOT NULL DEFAULT 0,
  credit_raw            NUMERIC(18, 4) NOT NULL DEFAULT 0,
  closing_balance_raw   NUMERIC(18, 4) NOT NULL DEFAULT 0,

  -- ── Normalized values: sign-corrected for reporting ─────────────────────
  -- RULE: ALL reports, UI tables, and analytics must use these columns.
  -- asset/expense: normalized = raw * -1
  -- liability/capital/income: normalized = raw (unchanged)
  opening_balance_normalized   NUMERIC(18, 4) NOT NULL DEFAULT 0,
  debit_normalized             NUMERIC(18, 4) NOT NULL DEFAULT 0,
  credit_normalized            NUMERIC(18, 4) NOT NULL DEFAULT 0,
  closing_balance_normalized   NUMERIC(18, 4) NOT NULL DEFAULT 0,

  -- ── Audit trail ─────────────────────────────────────────────────────────
  -- Records which normalization rule was applied to this row
  sign_rule_applied  TEXT    NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.tally_tb_rows IS 'Parsed Tally TB rows — raw values preserved, normalized values for reporting';
COMMENT ON COLUMN public.tally_tb_rows.opening_balance_raw  IS 'As-is from XML — Tally sign convention, NOT for UI/reports';
COMMENT ON COLUMN public.tally_tb_rows.debit_raw            IS 'As-is from XML — Tally sign convention, NOT for UI/reports';
COMMENT ON COLUMN public.tally_tb_rows.credit_raw           IS 'As-is from XML — Tally sign convention, NOT for UI/reports';
COMMENT ON COLUMN public.tally_tb_rows.closing_balance_raw  IS 'As-is from XML — Tally sign convention, NOT for UI/reports';
COMMENT ON COLUMN public.tally_tb_rows.opening_balance_normalized  IS 'Sign-corrected for reports: asset/expense = raw*-1, others = raw';
COMMENT ON COLUMN public.tally_tb_rows.debit_normalized            IS 'Sign-corrected for reports: asset/expense = raw*-1, others = raw';
COMMENT ON COLUMN public.tally_tb_rows.credit_normalized           IS 'Sign-corrected for reports: asset/expense = raw*-1, others = raw';
COMMENT ON COLUMN public.tally_tb_rows.closing_balance_normalized  IS 'Sign-corrected for reports: asset/expense = raw*-1, others = raw';
COMMENT ON COLUMN public.tally_tb_rows.sign_rule_applied           IS 'Human-readable description of the sign rule applied — audit trail';

-- ─── 3. tally_processing_logs ───────────────────────────────────────────────
-- Per-event log entries for each upload processing cycle.
-- Written by the Node.js service; readable via GET /logs/:upload_id API.

CREATE TABLE IF NOT EXISTS public.tally_processing_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id     UUID        NOT NULL
                            REFERENCES public.tally_xml_uploads(id) ON DELETE CASCADE,
  log_level     TEXT        NOT NULL DEFAULT 'info'
                            CHECK (log_level IN ('info', 'warn', 'error')),
  log_message   TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.tally_processing_logs IS 'Processing event log per XML upload — info/warn/error entries';
COMMENT ON COLUMN public.tally_processing_logs.log_level IS 'info | warn | error';

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Rows lookup by upload (most common query)
CREATE INDEX IF NOT EXISTS idx_tally_tb_rows_upload_id
  ON public.tally_tb_rows (upload_id);

-- Rows lookup by category (for category-filtered reports)
CREATE INDEX IF NOT EXISTS idx_tally_tb_rows_category
  ON public.tally_tb_rows (upload_id, account_category);

-- Display name search (for ledger lookup by name)
CREATE INDEX IF NOT EXISTS idx_tally_tb_rows_display_name
  ON public.tally_tb_rows (upload_id, display_name);

-- Logs lookup by upload
CREATE INDEX IF NOT EXISTS idx_tally_processing_logs_upload_id
  ON public.tally_processing_logs (upload_id, created_at);

-- Uploads ordered by newest first (admin/listing views)
CREATE INDEX IF NOT EXISTS idx_tally_xml_uploads_created_at
  ON public.tally_xml_uploads (created_at DESC);

-- ─── Row Level Security (RLS) ─────────────────────────────────────────────────
-- The Node.js service uses SERVICE ROLE key which bypasses RLS.
-- Enabling RLS prevents direct client-side reads without service role.

ALTER TABLE public.tally_xml_uploads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tally_tb_rows         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tally_processing_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read uploads (no write via frontend)
CREATE POLICY IF NOT EXISTS "authenticated can read tally_xml_uploads"
  ON public.tally_xml_uploads
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY IF NOT EXISTS "authenticated can read tally_tb_rows"
  ON public.tally_tb_rows
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY IF NOT EXISTS "authenticated can read tally_processing_logs"
  ON public.tally_processing_logs
  FOR SELECT
  TO authenticated
  USING (true);

-- ─── PostgREST schema reload ──────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
