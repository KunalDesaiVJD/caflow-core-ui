-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT WORKSHEET MODULE — Migration
-- Creates two tables for the Audit Worksheet sub-module (Stage 6: Audit Sheet):
--   1. audit_worksheet_master — one row per engagement (Tax / Internal master)
--   2. audit_worksheet_items  — per-row entries for Worksheet, Special Attention, Checklist
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Table 1: Master data (Tax Audit Master + Internal Audit Master) ────────
CREATE TABLE IF NOT EXISTS public.audit_worksheet_master (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id         UUID NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  firm_id               UUID REFERENCES public.firms(id),

  -- ── Tax Audit Master fields ──────────────────────────────────────────────
  -- Auto-filled from client / engagement on first load, user-editable thereafter
  tax_client_name       TEXT,
  tax_address           TEXT,
  tax_pan               TEXT,
  tax_cin               TEXT,
  tax_gstin             TEXT,
  tax_entity_type       TEXT,
  tax_financial_year    TEXT,          -- e.g. "2024-25"
  tax_period_from       DATE,          -- 01-Apr of FY
  tax_period_to         DATE,          -- 31-Mar of FY
  tax_prev_year_from    DATE,          -- previous year start
  tax_prev_year_to      DATE,          -- previous year end
  tax_turnover          NUMERIC,
  tax_accounting_method TEXT DEFAULT 'Mercantile',  -- 'Cash' | 'Mercantile'
  tax_section           TEXT DEFAULT '44AB(a)',      -- 44AB(a/b/c/d)
  tax_form_type         TEXT DEFAULT '3CB',          -- '3CA' | '3CB'
  tax_remarks           TEXT,
  -- Auditor details (auto-filled from audit_firms)
  tax_auditor_firm      TEXT,
  tax_auditor_address   TEXT,
  tax_icai_reg          TEXT,
  tax_partner_name      TEXT,
  tax_partner_icai      TEXT,
  tax_udin              TEXT,

  -- ── Internal Audit Master fields ─────────────────────────────────────────
  int_client_name       TEXT,
  int_address           TEXT,
  int_pan               TEXT,
  int_entity_type       TEXT,
  int_financial_year    TEXT,
  int_period_label      TEXT,          -- e.g. "Q1 2024-25" or "Annual 2024-25"
  int_period_from       DATE,
  int_period_to         DATE,
  int_scope             TEXT,
  int_objectives        TEXT,
  int_methodology       TEXT,
  int_audit_firm        TEXT,
  int_partner_name      TEXT,
  int_team_members      TEXT,

  -- ── Query gate ───────────────────────────────────────────────────────────
  queries_verified      BOOLEAN DEFAULT FALSE,
  queries_verified_by   UUID REFERENCES public.users(id),
  queries_verified_at   TIMESTAMPTZ,
  queries_notes         TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_worksheet_master_engagement UNIQUE (engagement_id)
);

ALTER TABLE public.audit_worksheet_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "awm_select" ON public.audit_worksheet_master FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "awm_insert" ON public.audit_worksheet_master FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "awm_update" ON public.audit_worksheet_master FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "awm_delete" ON public.audit_worksheet_master FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE INDEX IF NOT EXISTS idx_awm_engagement ON public.audit_worksheet_master(engagement_id);

-- ── Table 2: Worksheet / Special Attention / Checklist row entries ─────────
CREATE TABLE IF NOT EXISTS public.audit_worksheet_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  firm_id         UUID REFERENCES public.firms(id),

  -- Discriminator: which sheet this row belongs to
  sheet_type      TEXT NOT NULL CHECK (sheet_type IN ('worksheet', 'special_attention', 'checklist')),

  sr_no           INTEGER,
  particulars     TEXT,          -- Area / checklist item description
  work_done       TEXT,          -- Work performed / procedure
  remarks         TEXT,

  -- Employee assignment (Worksheet sheet)
  assigned_to     UUID REFERENCES public.users(id),
  assigned_name   TEXT,          -- denormalised for display

  -- Status / completion
  is_done         BOOLEAN DEFAULT FALSE,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','na')),
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('high','normal','low')),
  due_date        DATE,
  completed_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_worksheet_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "awi_select" ON public.audit_worksheet_items FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "awi_insert" ON public.audit_worksheet_items FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "awi_update" ON public.audit_worksheet_items FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "awi_delete" ON public.audit_worksheet_items FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE INDEX IF NOT EXISTS idx_awi_engagement ON public.audit_worksheet_items(engagement_id);
CREATE INDEX IF NOT EXISTS idx_awi_sheet     ON public.audit_worksheet_items(engagement_id, sheet_type);
