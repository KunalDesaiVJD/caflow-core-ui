-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-04-21 · Prior-year data-sourcing flow
--
-- Supports three PY comparative sources:
--   1. prior_engagement  — a real CAFlow audit engagement exists for FY-1
--   2. py_shell          — a cut-down FY-1 engagement is created only to hold
--                          imported PY TB + mapping + FS (no sign-off flow)
--   3. manual            — user types PY P&L amounts + note-wise annexure rows
--                          directly into the CY engagement
--
-- Columns added to audit_engagements:
--   py_source              TEXT   — one of the three values above (nullable)
--   py_setup_completed     BOOL   — flips true once PY source is confirmed
--   is_py_shell            BOOL   — marks an engagement as a read-only PY shell
--   py_manual_annexures    JSONB  — note-wise PY ledger breakdown, keyed by
--                                   FS line_item_code → [{ledger_name, amount, group?}]
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS py_source           TEXT,
  ADD COLUMN IF NOT EXISTS py_setup_completed  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_py_shell         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS py_manual_annexures JSONB   NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.audit_engagements.py_source IS
  'Source of PY comparative: prior_engagement | py_shell | manual | none';
COMMENT ON COLUMN public.audit_engagements.is_py_shell IS
  'TRUE for cut-down FY-1 engagements created only to hold PY data. UI hides
   them from main audit lists and from signoff flows.';
COMMENT ON COLUMN public.audit_engagements.py_manual_annexures IS
  'Manual PY note-wise ledger breakdown, keyed by FS line_item_code.
   Shape: { "<fs_code>": [{"ledger_name": "...", "amount": 123.45, "group": "..."}] }';

-- Partial index to find an existing shell for a client+FY quickly
CREATE INDEX IF NOT EXISTS audit_engagements_py_shell_idx
  ON public.audit_engagements(client_id, financial_year)
  WHERE is_py_shell = true;
