-- ─────────────────────────────────────────────────────────────────────────────
-- Phase TDS-1  ·  TDS Analytics & Reconciliation — Database Foundation
-- Tables:
--   1. tds_tb_party_mappings  — AI-matched TB ledger ↔ TDS deductee pairs
--   2. tds_recon_flags        — Discrepancy flags raised by the recon engine
-- NOTE: RLS uses public.users.firm_id (not firm_users — doesn't exist)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tds_tb_party_mappings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_tb_party_mappings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id            uuid        NOT NULL,
  financial_year     text        NOT NULL,
  tb_ledger_name     text        NOT NULL,
  tb_parent_group    text,
  tb_total_debit     numeric,
  tds_deductee_name  text        NOT NULL,
  tds_section_code   text,
  tds_total_amount   numeric,
  tds_filing_ids     uuid[]      DEFAULT '{}',
  match_confidence   integer     CHECK (match_confidence BETWEEN 0 AND 100),
  match_method       text,
  ai_reasoning       text,
  mapping_status     text        NOT NULL DEFAULT 'pending',
  mapped_by          text,
  notes              text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  UNIQUE (client_id, financial_year, tb_ledger_name, tds_deductee_name)
);

CREATE INDEX IF NOT EXISTS tds_tb_party_mappings_client_fy
  ON public.tds_tb_party_mappings (client_id, financial_year);

CREATE INDEX IF NOT EXISTS tds_tb_party_mappings_status
  ON public.tds_tb_party_mappings (client_id, financial_year, mapping_status);

-- ── 2. tds_recon_flags ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_recon_flags (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id            uuid        NOT NULL,
  financial_year     text        NOT NULL,
  flag_type          text        NOT NULL,
  goal_number        integer     CHECK (goal_number IN (1, 2, 3)),
  tb_ledger_name     text,
  tds_deductee_name  text,
  section_code       text,
  nature_of_payment  text,
  book_amount        numeric,
  tds_amount         numeric,
  expected_tds       numeric,
  actual_tds         numeric,
  variance_amount    numeric,
  expected_rate      numeric,
  actual_rate        numeric,
  threshold_amount   numeric,
  voucher_ids        uuid[]      DEFAULT '{}',
  deductee_ids       uuid[]      DEFAULT '{}',
  mapping_id         uuid        REFERENCES public.tds_tb_party_mappings(id),
  ai_reasoning       text,
  ai_confidence      integer     CHECK (ai_confidence BETWEEN 0 AND 100),
  sample_narrations  text[]      DEFAULT '{}',
  flag_status        text        NOT NULL DEFAULT 'pending',
  query_id           uuid,
  actioned_by        uuid,
  actioned_at        timestamptz,
  action_note        text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tds_recon_flags_client_fy_type
  ON public.tds_recon_flags (client_id, financial_year, flag_type, flag_status);

CREATE INDEX IF NOT EXISTS tds_recon_flags_client_fy_goal
  ON public.tds_recon_flags (client_id, financial_year, goal_number, flag_status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.tds_tb_party_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_recon_flags       ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (edge functions)
CREATE POLICY "service_role_all_mappings"
  ON public.tds_tb_party_mappings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_flags"
  ON public.tds_recon_flags FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated users: firm-scoped via users.firm_id
CREATE POLICY "auth_firm_mappings"
  ON public.tds_tb_party_mappings FOR ALL TO authenticated
  USING (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "auth_firm_flags"
  ON public.tds_recon_flags FOR ALL TO authenticated
  USING (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  );

-- ── updated_at triggers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tds_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER tds_tb_party_mappings_updated_at
  BEFORE UPDATE ON public.tds_tb_party_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

CREATE TRIGGER tds_recon_flags_updated_at
  BEFORE UPDATE ON public.tds_recon_flags
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();
