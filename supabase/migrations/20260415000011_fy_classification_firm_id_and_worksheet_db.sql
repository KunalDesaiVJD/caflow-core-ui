-- Migration 20260415000011
-- 1. Ensure audit_worksheet_master table + JSON columns exist
--    (migrations 20260406100000–250000 were marked applied without running)
-- 2. Add firm_id to client_fy_classifications for direct firm-scoped queries
-- 3. Add gstin_addresses column to clients

-- ── 1a. Create audit_worksheet_master if not already present ───────────────

CREATE TABLE IF NOT EXISTS public.audit_worksheet_master (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id         UUID NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  firm_id               UUID REFERENCES public.firms(id),
  tax_client_name       TEXT,
  tax_address           TEXT,
  tax_pan               TEXT,
  tax_cin               TEXT,
  tax_gstin             TEXT,
  tax_entity_type       TEXT,
  tax_financial_year    TEXT,
  tax_period_from       DATE,
  tax_period_to         DATE,
  tax_prev_year_from    DATE,
  tax_prev_year_to      DATE,
  tax_turnover          NUMERIC,
  tax_accounting_method TEXT DEFAULT 'Mercantile',
  tax_section           TEXT DEFAULT '44AB(a)',
  tax_form_type         TEXT DEFAULT '3CB',
  tax_remarks           TEXT,
  tax_auditor_firm      TEXT,
  tax_auditor_address   TEXT,
  tax_icai_reg          TEXT,
  tax_partner_name      TEXT,
  tax_partner_icai      TEXT,
  tax_udin              TEXT,
  int_client_name       TEXT,
  int_address           TEXT,
  int_pan               TEXT,
  int_entity_type       TEXT,
  int_financial_year    TEXT,
  int_period_label      TEXT,
  int_period_from       DATE,
  int_period_to         DATE,
  int_scope             TEXT,
  int_objectives        TEXT,
  int_methodology       TEXT,
  int_audit_firm        TEXT,
  int_partner_name      TEXT,
  int_team_members      TEXT,
  queries_verified      BOOLEAN DEFAULT FALSE,
  queries_verified_by   UUID REFERENCES public.users(id),
  queries_verified_at   TIMESTAMPTZ,
  queries_notes         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_worksheet_master_engagement UNIQUE (engagement_id)
);

ALTER TABLE public.audit_worksheet_master ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_master' AND policyname = 'awm_select'
  ) THEN
    CREATE POLICY "awm_select" ON public.audit_worksheet_master FOR SELECT TO authenticated
      USING (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_master' AND policyname = 'awm_insert'
  ) THEN
    CREATE POLICY "awm_insert" ON public.audit_worksheet_master FOR INSERT TO authenticated
      WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_master' AND policyname = 'awm_update'
  ) THEN
    CREATE POLICY "awm_update" ON public.audit_worksheet_master FOR UPDATE TO authenticated
      USING (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_master' AND policyname = 'awm_delete'
  ) THEN
    CREATE POLICY "awm_delete" ON public.audit_worksheet_master FOR DELETE TO authenticated
      USING (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_awm_engagement ON public.audit_worksheet_master(engagement_id);

-- ── 1b. Create audit_worksheet_items if not already present ───────────────

CREATE TABLE IF NOT EXISTS public.audit_worksheet_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  firm_id         UUID REFERENCES public.firms(id),
  sheet_type      TEXT NOT NULL CHECK (sheet_type IN ('worksheet', 'special_attention', 'checklist')),
  sr_no           INTEGER,
  particulars     TEXT,
  work_done       TEXT,
  remarks         TEXT,
  assigned_to     UUID REFERENCES public.users(id),
  assigned_name   TEXT,
  is_done         BOOLEAN DEFAULT FALSE,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','na')),
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('high','normal','low')),
  due_date        DATE,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_worksheet_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_items' AND policyname = 'awi_select') THEN
    CREATE POLICY "awi_select" ON public.audit_worksheet_items FOR SELECT TO authenticated
      USING (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_items' AND policyname = 'awi_insert') THEN
    CREATE POLICY "awi_insert" ON public.audit_worksheet_items FOR INSERT TO authenticated
      WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_items' AND policyname = 'awi_update') THEN
    CREATE POLICY "awi_update" ON public.audit_worksheet_items FOR UPDATE TO authenticated
      USING (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_worksheet_items' AND policyname = 'awi_delete') THEN
    CREATE POLICY "awi_delete" ON public.audit_worksheet_items FOR DELETE TO authenticated
      USING (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_awi_engagement ON public.audit_worksheet_items(engagement_id);
CREATE INDEX IF NOT EXISTS idx_awi_sheet ON public.audit_worksheet_items(engagement_id, sheet_type);

-- ── 1c. JSON columns (from migrations 20260406200000–250000) ───────────────

ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS tax_master_json        JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS int_master_json         JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS special_attention_json  JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS worksheet_json          JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS query_sheet_json        JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS checklist_sheet_json    JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS statutory_master_json   JSONB DEFAULT '{}'::JSONB;

-- ── 2. client_fy_classifications.firm_id ───────────────────────────────────

ALTER TABLE client_fy_classifications
  ADD COLUMN IF NOT EXISTS firm_id uuid REFERENCES firms(id);

UPDATE client_fy_classifications cfc
SET firm_id = c.firm_id
FROM clients c
WHERE c.id = cfc.client_id
  AND cfc.firm_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cfc_firm_fy
  ON client_fy_classifications(firm_id, financial_year);

DROP POLICY IF EXISTS "firm_select_fy_classifications" ON client_fy_classifications;
CREATE POLICY "firm_select_fy_classifications" ON client_fy_classifications
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

DROP POLICY IF EXISTS "firm_insert_fy_classifications" ON client_fy_classifications;
CREATE POLICY "firm_insert_fy_classifications" ON client_fy_classifications
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

DROP POLICY IF EXISTS "firm_update_fy_classifications" ON client_fy_classifications;
CREATE POLICY "firm_update_fy_classifications" ON client_fy_classifications
  FOR UPDATE TO authenticated
  USING  (is_superadmin() OR firm_id = current_user_firm_id())
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

-- ── 3. clients.gstin_addresses ─────────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS gstin_addresses jsonb NOT NULL DEFAULT '{}'::jsonb;
