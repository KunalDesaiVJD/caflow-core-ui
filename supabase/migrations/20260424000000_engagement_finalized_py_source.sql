-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-04-24 · Engagement finalisation flag + PY source enum expansion
--
-- WHY:
--   The sign-off step (Stage 9 — Sign-off & UDIN) marks an engagement as
--   legally completed. The NEXT year's engagement needs to know whether the
--   prior-year audit was fully finalised inside CAFlow so it can:
--     1. Auto-populate PY P&L figures from fa_financial_statements (reliable)
--     2. Lock manual PY P&L overrides (prevent accidental editing of proven data)
--     3. Show the correct PY data source badge in Stage 3 COA Mapping
--
-- COLUMNS ADDED to audit_engagements:
--   is_finalized   BOOL  — flips TRUE when UDIN is issued (Stage 9 sign-off)
--   finalized_at   TSTZ  — timestamp of sign-off
--   finalized_by   UUID  — user who performed sign-off (references auth.users)
--
-- PY SOURCE VALUES (py_source TEXT column — already exists):
--   prior_engagement  — FY-1 audit exists and is finalised in CAFlow (Option 1)
--   running_tally     — same Tally file, opening balances carry BS; P&L sync needed (Option 2)
--   py_shell          — separate Tally file → import as PY shell engagement (Option 3)
--   manual            — no Tally / no prior engagement; PY P&L entered manually (Option 4)
--   first_year        — first-year engagement; no PY comparative at all (Option 5)
--   (NULL)            — not yet selected by user
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS is_finalized  BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.audit_engagements.is_finalized IS
  'TRUE when Stage 9 Sign-off & UDIN has been completed. Used by the NEXT year''s
   engagement to: (a) auto-pull PY P&L from fa_financial_statements, (b) lock
   manual PY P&L overrides, (c) show "Prior engagement in CAFlow" badge.';

COMMENT ON COLUMN public.audit_engagements.finalized_at IS
  'Timestamp when is_finalized was set to TRUE (i.e. sign-off completed).';

COMMENT ON COLUMN public.audit_engagements.finalized_by IS
  'User (partner/manager) who completed sign-off and issued UDIN.';

-- Back-fill: any engagement already signed off (final_locked=true, signed_at IS NOT NULL)
-- is treated as finalized. This ensures existing completed engagements participate
-- correctly in the PY data source logic without requiring re-sign-off.
UPDATE public.audit_engagements
SET
  is_finalized = true,
  finalized_at = COALESCE(signed_at, sign_off_date::timestamptz),
  finalized_by = COALESCE(signed_by, sign_off_by)
WHERE
  final_locked = true
  AND signed_at IS NOT NULL
  AND is_finalized = false;

-- Index for the common query: "does this client have a finalised FY-1 engagement?"
CREATE INDEX IF NOT EXISTS audit_engagements_finalized_client_fy_idx
  ON public.audit_engagements(client_id, financial_year)
  WHERE is_finalized = true;

-- Update the py_source comment to document all 5 option values
COMMENT ON COLUMN public.audit_engagements.py_source IS
  'How prior-year comparative data is sourced. One of:
   prior_engagement — FY-1 audit finalised in CAFlow (fully automatic)
   running_tally    — same Tally file; BS from opening balances, P&L via "Sync PY P&L" button
   py_shell         — separate Tally file; user runs sync against prior-year file
   manual           — no Tally/no prior engagement; user types PY P&L amounts
   first_year       — first engagement for this client; no PY comparative shown
   NULL             — not yet selected by user in Stage 1';
