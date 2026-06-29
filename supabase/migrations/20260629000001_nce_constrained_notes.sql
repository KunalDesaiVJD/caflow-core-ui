-- ─────────────────────────────────────────────────────────────────────────
-- nce_constrained_notes — data layer for the constrained-edit Capital & PPE
-- notes (FS_NCE_CONSTRAINED_NOTES). NCE-only. Inert until the flag is ON.
--
-- Invariant these tables exist to support: the CLOSING total of each note is
-- NEVER a typed input — it is Σ(movements) + a derived balancer = (COA total −
-- Σ movements), so `Σ closing ≡ COA` by construction (CY and PY). The tie is
-- re-asserted server-side by the `save-nce-constrained-note` edge function,
-- which re-derives COA with the SAME computeCOATotals used by the BS/PL face
-- (no SQL re-implementation → no parity drift). Direct client writes are NOT
-- granted; the edge function writes with the service role after validating
-- role + firm-scope + notes_finalized + the COA tie.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. nce_capital_note — editable owners'/partners' capital breakup ────────
-- Capital has no note table today (NCE_CAP is a plug line). This is the
-- editable disclosure layer whose Σ closing is pinned to COA NCE_CAP.
CREATE TABLE IF NOT EXISTS nce_capital_note (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id      UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  financial_year     TEXT NOT NULL,
  col                TEXT NOT NULL CHECK (col IN ('cy', 'py')),
  partner_name       TEXT NOT NULL,
  -- EDITABLE movement components (the employee types these):
  opening            NUMERIC NOT NULL DEFAULT 0,
  introduced         NUMERIC NOT NULL DEFAULT 0,
  profit_share       NUMERIC NOT NULL DEFAULT 0,
  interest_on_cap    NUMERIC NOT NULL DEFAULT 0,
  remuneration       NUMERIC NOT NULL DEFAULT 0,
  drawings           NUMERIC NOT NULL DEFAULT 0,   -- stored positive; subtracts
  -- DERIVED per-row closing — the DB owns row identity so no one can type a
  -- closing that disagrees with its own components. (Note-level Σ closing ≡ COA
  -- is enforced separately by the edge function.)
  closing NUMERIC GENERATED ALWAYS AS
    (opening + introduced + profit_share + interest_on_cap + remuneration - drawings) STORED,
  -- RECONCILIATION metadata (engine-written, never user-typed):
  is_balancing_row   BOOLEAN NOT NULL DEFAULT FALSE,  -- the row carrying the balancer
  coa_anchor_closing NUMERIC,                          -- COA NCE_CAP snapshot at last save
  is_stale           BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE after a re-sync changed COA
  sort_order         INTEGER NOT NULL DEFAULT 0,
  updated_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, financial_year, partner_name, col)
);

CREATE INDEX IF NOT EXISTS idx_nce_capital_note_eng
  ON nce_capital_note (engagement_id, financial_year);

COMMENT ON TABLE nce_capital_note IS
  'Editable owners/partners capital breakup. Sum of closing per col is pinned to COA NCE_CAP by the save-nce-constrained-note edge function. FS_NCE_CONSTRAINED_NOTES.';

ALTER TABLE nce_capital_note ENABLE ROW LEVEL SECURITY;

-- SELECT only for firm members (mirrors nce_capital_account policy). No INSERT/
-- UPDATE/DELETE grant: the edge function writes via the service role after the
-- COA tie + role + finalized checks. This is the restricted-access gate.
DROP POLICY IF EXISTS "NCE capital note — firm members read" ON nce_capital_note;
CREATE POLICY "NCE capital note — firm members read"
  ON nce_capital_note
  FOR SELECT
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );

GRANT SELECT ON nce_capital_note TO anon, authenticated;

-- ── 2. nce_ppe_schedule — extend for PY columns + COA bridge ────────────────
-- Existing table holds CY gross/additions/deletions/depreciation/closing per
-- asset_category. Add the PY mirror, the coa_code bridge (so reconciliation
-- runs per code), the balancing-class flag, and the COA anchors. All additive
-- + IF NOT EXISTS → safe no-op if any already exist (deletions was added by
-- 20260617000001).
ALTER TABLE nce_ppe_schedule
  ADD COLUMN IF NOT EXISTS deletions          NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_py         NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additions_py       NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deletions_py       NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depreciation_py    NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_py         NUMERIC NOT NULL DEFAULT 0,
  -- reconciliation bridge: 'NCE_PPE' (tangible) | 'NCE_INTG' (intangible)
  ADD COLUMN IF NOT EXISTS coa_code           TEXT,
  ADD COLUMN IF NOT EXISTS is_balancing_class BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS coa_anchor_net     NUMERIC,  -- COA NCE_PPE/NCE_INTG snapshot
  ADD COLUMN IF NOT EXISTS coa_anchor_depr    NUMERIC,  -- COA NCE_DEPR snapshot
  ADD COLUMN IF NOT EXISTS is_stale           BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN nce_ppe_schedule.coa_code IS
  'Reconciliation bridge to COA: NCE_PPE for tangible rows, NCE_INTG for intangible. Σ closing per coa_code is pinned to COA; Σ depreciation is pinned to COA NCE_DEPR. FS_NCE_CONSTRAINED_NOTES.';

-- NOTE: direct write GRANTs on nce_ppe_schedule are intentionally NOT revoked
-- in this migration — the existing Stage-8 UI still saves directly. The revoke
-- happens in the phase that switches the PPE UI to the edge function, so there
-- is never a window where saves are broken.
