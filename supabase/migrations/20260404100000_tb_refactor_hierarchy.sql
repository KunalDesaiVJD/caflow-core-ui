-- ═══════════════════════════════════════════════════════════════════════════
-- CAFlow — TB Hierarchy Refactor: Explicit Hierarchy + Override + Validation
-- Migration: 20260404100000_tb_refactor_hierarchy
--
-- New tables:
--   1. tb_import_rows_raw       — raw XML rows, immutable after insert
--   2. tb_import_rows_resolved  — hierarchy-resolved rows, rebuilt on re-import
--   3. tb_manual_overrides      — user corrections, persist across re-imports
--   4. tb_ai_suggestions        — AI-proposed hierarchy/classification (advisory)
--   5. tb_validation_issues     — per-import validation findings
--   6. tb_constitution_profiles — detected or user-set constitution per engagement
--   7. tb_publish_snapshots     — final published TB (read-only snapshot)
--
-- Design rules:
--   • Raw rows are NEVER modified after initial insert
--   • Resolved rows are rebuilt on every re-import by applying raw + overrides
--   • Manual overrides are keyed by (engagement_id, normalized_name) so they
--     survive re-imports and file changes
--   • AI suggestions are advisory only — never auto-committed
--   • A TB is not shown in the pipeline until it passes validation OR the user
--     explicitly overrides the validation gate (override_validation = true)
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. tb_import_rows_raw ───────────────────────────────────────────────────
-- Immutable record of every row extracted from the XML/XLSX file.
-- One row per DSPACCNAME/DSPACCINFO pair (XML) or spreadsheet row (Excel).
-- NEVER UPDATE these columns after insert — they are the audit source of truth.

CREATE TABLE IF NOT EXISTS public.tb_import_rows_raw (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id     UUID          NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  import_batch_id   UUID          NOT NULL,          -- FK to ledger_import_batches
  row_number        INTEGER       NOT NULL,           -- 1-based position in file
  source_file_name  TEXT          NOT NULL,

  -- ── Raw identity ──────────────────────────────────────────────────────────
  raw_name          TEXT          NOT NULL,           -- DSPDISPNAME or cell value, untouched
  display_name      TEXT          NOT NULL,           -- same as raw_name for XML; trimmed for Excel

  -- ── Raw numeric values: exactly as extracted from source ─────────────────
  opening_raw       NUMERIC(20,4) NOT NULL DEFAULT 0,
  debit_raw         NUMERIC(20,4) NOT NULL DEFAULT 0,
  credit_raw        NUMERIC(20,4) NOT NULL DEFAULT 0,
  closing_raw       NUMERIC(20,4) NOT NULL DEFAULT 0,

  -- ── Source-level structural hints (extracted from XML if present) ─────────
  xml_level         SMALLINT      NULL,               -- DSPACCNAMELEVEL if present in XML
  xml_is_leaf       BOOLEAN       NULL,               -- DSPACCACCISLEAF if present in XML
  xml_parent_name   TEXT          NULL,               -- explicit parent name from XML, if exported
  xml_primary_group TEXT          NULL,               -- Tally's internal primary group if exported
  source_format     TEXT          NOT NULL DEFAULT 'tally_xml'
                                  CHECK (source_format IN ('tally_xml','tally_excel','generic_excel','json')),

  -- ── Structural extraction metadata ───────────────────────────────────────
  hierarchy_source  TEXT          NOT NULL DEFAULT 'unknown'
                                  CHECK (hierarchy_source IN (
                                    'xml_explicit',   -- xml_level + xml_is_leaf both present
                                    'xml_level_only', -- xml_level present, is_leaf inferred
                                    'bold_cell',      -- Excel: bold = group
                                    'value_sum',      -- fallback: value-sum matching
                                    'unknown'
                                  )),

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (engagement_id, import_batch_id, row_number)
);

COMMENT ON TABLE  public.tb_import_rows_raw IS 'Immutable raw rows from TB import — never modified after insert';
COMMENT ON COLUMN public.tb_import_rows_raw.xml_level        IS 'DSPACCNAMELEVEL from XML: 1=root group, 2=subgroup, 3+=leaf; NULL if not in XML';
COMMENT ON COLUMN public.tb_import_rows_raw.xml_is_leaf      IS 'DSPACCACCISLEAF from XML: true=ledger, false=group; NULL if not in XML';
COMMENT ON COLUMN public.tb_import_rows_raw.hierarchy_source IS 'How the structural hints were obtained for this row';


-- ─── 2. tb_import_rows_resolved ──────────────────────────────────────────────
-- Hierarchy-resolved, sign-corrected, classified rows.
-- Rebuilt on every re-import by the edge function.
-- References tb_import_rows_raw(id) for the source row.

CREATE TABLE IF NOT EXISTS public.tb_import_rows_resolved (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_row_id        UUID          NOT NULL REFERENCES public.tb_import_rows_raw(id) ON DELETE CASCADE,
  engagement_id     UUID          NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  import_batch_id   UUID          NOT NULL,
  row_number        INTEGER       NOT NULL,

  -- ── Identity ──────────────────────────────────────────────────────────────
  display_name      TEXT          NOT NULL,
  normalized_name   TEXT          NOT NULL,           -- lowercase, stripped for matching

  -- ── Hierarchy ─────────────────────────────────────────────────────────────
  row_type          TEXT          NOT NULL DEFAULT 'unknown'
                                  CHECK (row_type IN ('group','subgroup','ledger','unknown')),
  parent_row_id     UUID          NULL REFERENCES public.tb_import_rows_resolved(id),
  parent_name       TEXT          NULL,
  level             SMALLINT      NOT NULL DEFAULT 1,
  hierarchy_path    TEXT          NULL,               -- e.g. "Capital Account > Partner Capital"
  primary_group     TEXT          NULL,               -- topmost ancestor name
  is_leaf           BOOLEAN       NOT NULL DEFAULT TRUE,

  -- ── Classification ────────────────────────────────────────────────────────
  bs_pl_side        TEXT          NOT NULL DEFAULT 'Unknown'
                                  CHECK (bs_pl_side IN ('BS','PL','Unknown')),
  normal_balance    TEXT          NOT NULL DEFAULT 'Unknown'
                                  CHECK (normal_balance IN ('Dr','Cr','Unknown')),
  section           TEXT          NULL                -- bs_asset | bs_liability | pl_income | pl_expense
                                  CHECK (section IN ('bs_asset','bs_liability','pl_income','pl_expense', NULL)),
  constitution_type TEXT          NULL,               -- detected constitution (see tb_constitution_profiles)

  -- ── Sign-corrected numeric values (use these for all display/reports) ─────
  opening_normalized  NUMERIC(20,4) NOT NULL DEFAULT 0,
  debit_normalized    NUMERIC(20,4) NOT NULL DEFAULT 0,
  credit_normalized   NUMERIC(20,4) NOT NULL DEFAULT 0,
  closing_normalized  NUMERIC(20,4) NOT NULL DEFAULT 0,
  sign_rule_applied   TEXT          NULL,             -- audit trail of what sign correction was used

  -- ── Confidence & override metadata ───────────────────────────────────────
  classification_confidence  NUMERIC(3,2)  NOT NULL DEFAULT 0.00  -- 0.00 to 1.00
                             CHECK (classification_confidence BETWEEN 0 AND 1),
  hierarchy_confidence       NUMERIC(3,2)  NOT NULL DEFAULT 0.00
                             CHECK (hierarchy_confidence BETWEEN 0 AND 1),
  has_manual_override        BOOLEAN       NOT NULL DEFAULT FALSE,
  has_ai_suggestion          BOOLEAN       NOT NULL DEFAULT FALSE,
  needs_review               BOOLEAN       NOT NULL DEFAULT FALSE,  -- low confidence, flag for user

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (engagement_id, import_batch_id, row_number)
);

COMMENT ON TABLE  public.tb_import_rows_resolved IS 'Hierarchy-resolved, sign-corrected TB rows — rebuilt on every re-import';
COMMENT ON COLUMN public.tb_import_rows_resolved.hierarchy_path       IS 'Full ancestor path for this row, slash-separated';
COMMENT ON COLUMN public.tb_import_rows_resolved.classification_confidence IS '0=unknown,1=certain; rows <0.7 are flagged needs_review';
COMMENT ON COLUMN public.tb_import_rows_resolved.sign_rule_applied    IS 'Which sign-correction rule was applied; null = no correction needed';


-- ─── 3. tb_manual_overrides ──────────────────────────────────────────────────
-- User corrections that persist across re-imports.
-- Keyed by (engagement_id, normalized_name) so they survive file changes.
-- Applied automatically during the resolve phase of every re-import.

CREATE TABLE IF NOT EXISTS public.tb_manual_overrides (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id         UUID          NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  normalized_name       TEXT          NOT NULL,       -- normalized ledger/group name to match
  display_name_hint     TEXT          NULL,           -- human-readable label for UI

  -- ── What the user overrode ────────────────────────────────────────────────
  override_row_type         TEXT    NULL CHECK (override_row_type     IN ('group','subgroup','ledger', NULL)),
  override_parent_name      TEXT    NULL,
  override_bs_pl_side       TEXT    NULL CHECK (override_bs_pl_side   IN ('BS','PL', NULL)),
  override_normal_balance   TEXT    NULL CHECK (override_normal_balance IN ('Dr','Cr', NULL)),
  override_section          TEXT    NULL CHECK (override_section IN ('bs_asset','bs_liability','pl_income','pl_expense', NULL)),
  override_constitution     TEXT    NULL,

  -- ── Lock flags — locked fields cannot be overwritten by AI or auto-detect ─
  lock_row_type       BOOLEAN NOT NULL DEFAULT FALSE,
  lock_parent         BOOLEAN NOT NULL DEFAULT FALSE,
  lock_classification BOOLEAN NOT NULL DEFAULT FALSE,
  lock_section        BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Audit ─────────────────────────────────────────────────────────────────
  created_by          UUID    NULL,                   -- user id
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (engagement_id, normalized_name)
);

COMMENT ON TABLE  public.tb_manual_overrides IS 'User corrections persisted across re-imports; keyed by engagement+normalized_name';
COMMENT ON COLUMN public.tb_manual_overrides.lock_classification IS 'When true, AI and auto-detect cannot change bs_pl_side or normal_balance';


-- ─── 4. tb_ai_suggestions ────────────────────────────────────────────────────
-- AI-proposed hierarchy and classification for low-confidence rows.
-- ADVISORY ONLY — never auto-committed to tb_import_rows_resolved.
-- User must explicitly accept each suggestion.

CREATE TABLE IF NOT EXISTS public.tb_ai_suggestions (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id     UUID    NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  import_batch_id   UUID    NOT NULL,
  resolved_row_id   UUID    NOT NULL REFERENCES public.tb_import_rows_resolved(id) ON DELETE CASCADE,
  display_name      TEXT    NOT NULL,

  -- ── AI's proposed values ──────────────────────────────────────────────────
  suggested_row_type        TEXT    NULL,
  suggested_parent_name     TEXT    NULL,
  suggested_primary_group   TEXT    NULL,
  suggested_bs_pl_side      TEXT    NULL,
  suggested_normal_balance  TEXT    NULL,
  suggested_section         TEXT    NULL,
  suggested_constitution    TEXT    NULL,

  -- ── Quality indicators ────────────────────────────────────────────────────
  confidence_score  NUMERIC(3,2) NOT NULL DEFAULT 0.00
                    CHECK (confidence_score BETWEEN 0 AND 1),
  explanation       TEXT    NULL,                     -- AI's reasoning, shown in UI

  -- ── User action ───────────────────────────────────────────────────────────
  status            TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','rejected','superseded')),
  reviewed_at       TIMESTAMPTZ NULL,
  reviewed_by       UUID    NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.tb_ai_suggestions IS 'AI-proposed hierarchy and classification — advisory only, requires user acceptance';
COMMENT ON COLUMN public.tb_ai_suggestions.status IS 'pending=unreviewed, accepted=user approved, rejected=user dismissed, superseded=manual override applied';


-- ─── 5. tb_validation_issues ─────────────────────────────────────────────────
-- Per-import validation findings produced by the validation engine.
-- Shown to user before publish. Some issues block publish; others are warnings.

CREATE TABLE IF NOT EXISTS public.tb_validation_issues (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id     UUID    NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  import_batch_id   UUID    NOT NULL,
  resolved_row_id   UUID    NULL REFERENCES public.tb_import_rows_resolved(id) ON DELETE SET NULL,

  -- ── Issue identity ────────────────────────────────────────────────────────
  issue_code        TEXT    NOT NULL,                 -- machine code e.g. ORPHAN_GROUP, DOUBLE_COUNT
  severity          TEXT    NOT NULL DEFAULT 'warning'
                    CHECK (severity IN ('error','warning','info')),
  title             TEXT    NOT NULL,                 -- short human title
  description       TEXT    NOT NULL,                 -- full explanation shown in UI
  affected_name     TEXT    NULL,                     -- which row/group is affected
  suggested_fix     TEXT    NULL,                     -- how to resolve it

  -- ── User action ───────────────────────────────────────────────────────────
  is_acknowledged   BOOLEAN NOT NULL DEFAULT FALSE,   -- user dismissed this warning
  acknowledged_at   TIMESTAMPTZ NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.tb_validation_issues IS 'Validation findings per import batch — errors block publish, warnings require acknowledgement';


-- ─── 6. tb_constitution_profiles ─────────────────────────────────────────────
-- Detected or user-set constitution type per engagement.
-- Used by the classification engine to apply constitution-specific rules.

CREATE TABLE IF NOT EXISTS public.tb_constitution_profiles (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id     UUID    NOT NULL UNIQUE
                            REFERENCES public.audit_engagements(id) ON DELETE CASCADE,

  constitution_type TEXT    NOT NULL DEFAULT 'unknown'
                    CHECK (constitution_type IN (
                      'proprietorship','partnership','llp',
                      'private_limited','public_limited',
                      'huf','jv','trust','unknown'
                    )),

  -- ── Detection metadata ────────────────────────────────────────────────────
  detection_method  TEXT    NOT NULL DEFAULT 'unknown'
                    CHECK (detection_method IN (
                      'client_metadata',   -- from clients.entity_type
                      'engagement_metadata', -- from audit_engagements
                      'naming_patterns',   -- inferred from account names in TB
                      'user_set',          -- user explicitly set it
                      'unknown'
                    )),
  detection_signals JSONB   NULL,                     -- which account names triggered detection
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 0.00,

  -- ── Lock ──────────────────────────────────────────────────────────────────
  is_locked         BOOLEAN NOT NULL DEFAULT FALSE,   -- user confirmed — don't re-detect

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.tb_constitution_profiles IS 'Detected or user-confirmed constitution type per engagement';


-- ─── 7. tb_publish_snapshots ─────────────────────────────────────────────────
-- Final published TB for an engagement.
-- Only created when user explicitly publishes after passing validation.
-- Immutable after publish — re-import creates a new batch + snapshot.

CREATE TABLE IF NOT EXISTS public.tb_publish_snapshots (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       UUID    NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  import_batch_id     UUID    NOT NULL,
  published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by        UUID    NULL,

  -- ── Summary stats ─────────────────────────────────────────────────────────
  total_rows          INTEGER NOT NULL DEFAULT 0,
  leaf_count          INTEGER NOT NULL DEFAULT 0,
  group_count         INTEGER NOT NULL DEFAULT 0,
  constitution_type   TEXT    NULL,
  is_balanced         BOOLEAN NOT NULL DEFAULT FALSE,
  bs_assets           NUMERIC(20,4) NULL,
  bs_liabilities      NUMERIC(20,4) NULL,
  balance_diff        NUMERIC(20,4) NULL,

  -- ── Validation gate ───────────────────────────────────────────────────────
  validation_passed   BOOLEAN NOT NULL DEFAULT FALSE,
  override_validation BOOLEAN NOT NULL DEFAULT FALSE, -- user explicitly overrode errors
  error_count         INTEGER NOT NULL DEFAULT 0,
  warning_count       INTEGER NOT NULL DEFAULT 0,
  acknowledged_count  INTEGER NOT NULL DEFAULT 0,

  notes               TEXT    NULL                    -- user notes on publish
);

COMMENT ON TABLE  public.tb_publish_snapshots IS 'Final published TB per engagement — immutable after creation';
COMMENT ON COLUMN public.tb_publish_snapshots.override_validation IS 'True when user published despite validation errors';


-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tb_raw_engagement    ON public.tb_import_rows_raw(engagement_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_tb_raw_row_number    ON public.tb_import_rows_raw(engagement_id, import_batch_id, row_number);

CREATE INDEX IF NOT EXISTS idx_tb_resolved_engagement ON public.tb_import_rows_resolved(engagement_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_tb_resolved_parent     ON public.tb_import_rows_resolved(parent_row_id);
CREATE INDEX IF NOT EXISTS idx_tb_resolved_needs_review ON public.tb_import_rows_resolved(engagement_id, needs_review) WHERE needs_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_tb_resolved_raw_row    ON public.tb_import_rows_resolved(raw_row_id);

CREATE INDEX IF NOT EXISTS idx_tb_overrides_engagement ON public.tb_manual_overrides(engagement_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_tb_ai_engagement       ON public.tb_ai_suggestions(engagement_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_tb_ai_pending          ON public.tb_ai_suggestions(engagement_id, status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tb_validation_batch    ON public.tb_validation_issues(engagement_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_tb_validation_errors   ON public.tb_validation_issues(engagement_id, severity) WHERE severity = 'error' AND is_acknowledged = FALSE;

CREATE INDEX IF NOT EXISTS idx_tb_publish_engagement  ON public.tb_publish_snapshots(engagement_id, published_at DESC);


-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.tb_import_rows_raw       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_import_rows_resolved  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_manual_overrides      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_ai_suggestions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_validation_issues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_constitution_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_publish_snapshots     ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all; writes go through edge functions (service role)
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tb_import_rows_raw','tb_import_rows_resolved','tb_manual_overrides',
    'tb_ai_suggestions','tb_validation_issues','tb_constitution_profiles',
    'tb_publish_snapshots'
  ] LOOP
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_read_%s" ON public.%I FOR SELECT TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_insert_%s" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_update_%s" ON public.%I FOR UPDATE TO authenticated USING (true)', tbl, tbl);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
