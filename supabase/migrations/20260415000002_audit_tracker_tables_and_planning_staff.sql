-- ─────────────────────────────────────────────────────────────────────────────
-- Audit Tracker: create tables in production + planning_staff table
-- Also adds financial_year to audit_status for AY-based filtering
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop and recreate audit tracker tables (idempotent)
DROP TABLE IF EXISTS public.audit_communication CASCADE;
DROP TABLE IF EXISTS public.audit_planning       CASCADE;
DROP TABLE IF EXISTS public.audit_status         CASCADE;

-- audit_planning
CREATE TABLE public.audit_planning (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id        UUID        REFERENCES public.firms(id)   ON DELETE CASCADE,
  client_id      UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name    TEXT,
  planned_from   DATE        NOT NULL,
  planned_to     DATE        NOT NULL,
  employee_ids   UUID[]      DEFAULT '{}',
  employee_names TEXT[]      DEFAULT '{}',
  created_by     UUID        REFERENCES public.users(id)   ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ap_firm  ON public.audit_planning(firm_id);
CREATE INDEX IF NOT EXISTS idx_ap_dates ON public.audit_planning(planned_from, planned_to);
ALTER TABLE public.audit_planning ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_members_audit_planning" ON public.audit_planning FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

-- audit_communication
CREATE TABLE public.audit_communication (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id            UUID        REFERENCES public.firms(id)          ON DELETE CASCADE,
  planning_id        UUID        REFERENCES public.audit_planning(id) ON DELETE CASCADE,
  client_name        TEXT,
  audit_planned_from DATE,
  audit_planned_to   DATE,
  contact_person     TEXT,
  contact_no         TEXT,
  remarks            TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ac_firm ON public.audit_communication(firm_id);
ALTER TABLE public.audit_communication ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_members_audit_communication" ON public.audit_communication FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

-- audit_status (with financial_year column for AY-based filtering)
CREATE TABLE public.audit_status (
  id                            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id                       UUID        REFERENCES public.firms(id)              ON DELETE CASCADE,
  client_id                     UUID        REFERENCES public.clients(id)            ON DELETE SET NULL,
  party_name                    TEXT,
  physical_audit_conducted      TEXT        DEFAULT 'No',
  accounting_data               TEXT        DEFAULT 'No',
  audit_employees               TEXT,
  audit_report_prepared_by      TEXT,
  audit_status                  TEXT,
  audit_status_other            TEXT,
  report_print_date             DATE,
  firm                          TEXT,
  partner                       TEXT,
  udin_tax_audit                TEXT,
  udin_statutory_audit          TEXT,
  udin_date                     DATE,
  physical_report_received_date DATE,
  scanned                       TEXT        DEFAULT 'No',
  prepared_by                   TEXT,
  checked_by                    TEXT,
  uploaded_by                   TEXT,
  remarks                       TEXT,
  engagement_id                 UUID        REFERENCES public.audit_engagements(id) ON DELETE SET NULL,
  financial_year                TEXT,
  created_at                    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_status_engagement_unique ON public.audit_status(engagement_id) WHERE engagement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_as_firm   ON public.audit_status(firm_id);
CREATE INDEX IF NOT EXISTS idx_as_fy     ON public.audit_status(financial_year);
ALTER TABLE public.audit_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_members_audit_status" ON public.audit_status FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

-- planning_staff: controls which employees appear as columns in Planning Calendar
CREATE TABLE IF NOT EXISTS public.planning_staff (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id    UUID        NOT NULL REFERENCES public.firms(id)  ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(firm_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_planning_staff_firm ON public.planning_staff(firm_id);
ALTER TABLE public.planning_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "planning_staff_firm_access" ON public.planning_staff FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'superadmin')
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'superadmin');
