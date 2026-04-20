-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-04-21 · Ledger aliases + manual PY P&L amounts
--
-- 1. ledger_aliases — links a "CLOSED" prior-year ledger name to its current
--    (renamed/reorganised) counterpart, per client. Used by Stage 6 COA
--    Mapping so that when a chart of accounts is reorganised mid-year, the
--    old ledger's opening_balance rolls up under the new ledger's FS code.
--
-- 2. audit_engagements.py_manual_amounts JSONB — stores user-entered PY P&L
--    amounts when no prior engagement exists. Shape: { "<fs_code>": <amount>, … }
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. ledger_aliases ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ledger_aliases (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id            UUID        REFERENCES public.firms(id) ON DELETE SET NULL,
  engagement_id      UUID        REFERENCES public.audit_engagements(id) ON DELETE SET NULL,

  -- The ledger name as it appears in the PRIOR year's books (opening ≠ 0, closing = 0).
  prior_ledger_name  TEXT        NOT NULL,
  -- The ledger name as it appears in the CURRENT year's books (opening = 0, closing ≠ 0).
  current_ledger_name TEXT       NOT NULL,

  note               TEXT,
  created_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ledger_alias_uq UNIQUE (client_id, prior_ledger_name)
);

CREATE INDEX IF NOT EXISTS ledger_aliases_client_idx      ON public.ledger_aliases(client_id);
CREATE INDEX IF NOT EXISTS ledger_aliases_engagement_idx  ON public.ledger_aliases(engagement_id);
CREATE INDEX IF NOT EXISTS ledger_aliases_current_idx     ON public.ledger_aliases(client_id, current_ledger_name);

-- RLS — members of the firm that owns the client can read/write aliases.
ALTER TABLE public.ledger_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_aliases_select ON public.ledger_aliases;
CREATE POLICY ledger_aliases_select ON public.ledger_aliases
  FOR SELECT USING (
    client_id IN (SELECT id FROM public.clients WHERE firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS ledger_aliases_write ON public.ledger_aliases;
CREATE POLICY ledger_aliases_write ON public.ledger_aliases
  FOR ALL USING (
    client_id IN (SELECT id FROM public.clients WHERE firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    ))
  ) WITH CHECK (
    client_id IN (SELECT id FROM public.clients WHERE firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    ))
  );

-- ─── 2. audit_engagements.py_manual_amounts ────────────────────────────────
ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS py_manual_amounts JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.audit_engagements.py_manual_amounts IS
  'User-entered PY P&L amounts keyed by FS line_item_code. Used by Stage 10 when no prior engagement exists.';
