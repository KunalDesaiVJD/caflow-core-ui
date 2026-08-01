-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: tds_voucher_classification  (Scenario 1 — voucher-level section override)
--
-- Purpose
-- ───────
-- Today a party mapping row (tds_tb_party_mappings) carries a SINGLE
-- section_code and every rupee posted to the underlying Tally ledger
-- is reconciled at that section's rate. That breaks the very common
-- case where one Tally party is billed for BOTH contract work (194C)
-- AND professional services (194J) — e.g. "ABC Pvt Ltd" in the auditor's
-- scenario. The engine currently forces a single section and the
-- reconciliation produces a spurious short-/over-deduction flag.
--
-- This table lets the auditor tag INDIVIDUAL vouchers (or later, line
-- items) posted against that ledger to a specific TDS section, so the
-- reconciliation engine can compare each section's book activity
-- against the correct deductee/section aggregate in the TDS module.
--
-- Grain
-- ─────
-- One row per (voucher_id, tb_ledger_name) — auditor's per-voucher
-- decision. If no row exists for a voucher, the mapping's default
-- section applies (backward compatible).
--
-- Cross-cutting notes
-- ───────────────────
-- • On Re-Tally-sync new vouchers appear in tally_vouchers; if the
--   auditor hasn't classified them yet they inherit the mapping's
--   default section. Existing classification rows are never touched.
-- • Deleting a mapping cascade-deletes its classifications so an
--   auditor's rejection of the mapping leaves no orphan overrides.
-- • Every write stamps created_by / updated_by so the workpaper
--   audit trail can defend "which auditor tagged which voucher and
--   when" during review.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tds_voucher_classification (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id               uuid        NOT NULL,
  financial_year        text        NOT NULL,
  engagement_id         uuid,       -- optional; kept for cross-linking to the tally engagement
  mapping_id            uuid        NOT NULL REFERENCES public.tds_tb_party_mappings(id) ON DELETE CASCADE,
  voucher_id            uuid        NOT NULL,
  tb_ledger_name        text        NOT NULL,
  -- Auditor's per-voucher override. NULL means "use mapping default",
  -- which is functionally equivalent to no row existing but is kept
  -- so the auditor can persist an explicit "reviewed, default applies"
  -- decision + a note.
  section_code_override text,
  -- Optional per-voucher deductee override for the Scenario-2 flow
  -- (multiple Tally ledgers → single TDS deductee) once that lands.
  tds_deductee_name_override text,
  notes                 text,
  -- 2026-08-01 — Scenario 3 (voucher inclusion filter) reuses this
  -- table by flipping this flag off. Default TRUE preserves the
  -- current "every voucher counts" behaviour.
  is_tds_applicable     boolean     NOT NULL DEFAULT true,
  exclusion_reason      text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, financial_year, voucher_id, tb_ledger_name)
);

CREATE INDEX IF NOT EXISTS tds_voucher_classification_mapping
  ON public.tds_voucher_classification (mapping_id);

CREATE INDEX IF NOT EXISTS tds_voucher_classification_client_fy
  ON public.tds_voucher_classification (client_id, financial_year);

CREATE INDEX IF NOT EXISTS tds_voucher_classification_ledger
  ON public.tds_voucher_classification (client_id, financial_year, tb_ledger_name);

CREATE INDEX IF NOT EXISTS tds_voucher_classification_voucher
  ON public.tds_voucher_classification (voucher_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tds_voucher_classification_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tds_voucher_classification_touch_updated
  ON public.tds_voucher_classification;

CREATE TRIGGER tds_voucher_classification_touch_updated
  BEFORE UPDATE ON public.tds_voucher_classification
  FOR EACH ROW
  EXECUTE FUNCTION public.tds_voucher_classification_touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.tds_voucher_classification ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (edge functions) — idempotent
DROP POLICY IF EXISTS "service_role_all_voucher_classification"
  ON public.tds_voucher_classification;
CREATE POLICY "service_role_all_voucher_classification"
  ON public.tds_voucher_classification FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated users: firm-scoped via users.firm_id — idempotent,
-- matches the pattern used by tds_tb_party_mappings + tds_recon_flags.
DROP POLICY IF EXISTS "auth_firm_voucher_classification"
  ON public.tds_voucher_classification;
CREATE POLICY "auth_firm_voucher_classification"
  ON public.tds_voucher_classification FOR ALL TO authenticated
  USING (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  );
