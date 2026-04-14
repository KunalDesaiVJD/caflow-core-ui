-- ─────────────────────────────────────────────────────────────────────────────
-- Audit Tracker v2 — rebuild with updated schema
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop v1 tables (safe to re-run)
DROP TABLE IF EXISTS public.audit_communication CASCADE;
DROP TABLE IF EXISTS public.audit_planning       CASCADE;
DROP TABLE IF EXISTS public.audit_status         CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at()  CASCADE;


-- ── 1. audit_planning ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_planning (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id         UUID        REFERENCES public.firms(id)    ON DELETE CASCADE,
  client_id       UUID        REFERENCES public.clients(id)  ON DELETE SET NULL,
  client_name     TEXT,
  planned_from    DATE        NOT NULL,
  planned_to      DATE        NOT NULL,
  employee_ids    UUID[]      DEFAULT '{}',
  employee_names  TEXT[]      DEFAULT '{}',
  created_by      UUID        REFERENCES public.users(id)    ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ap_firm   ON public.audit_planning(firm_id);
CREATE INDEX IF NOT EXISTS idx_ap_client ON public.audit_planning(client_id);
CREATE INDEX IF NOT EXISTS idx_ap_dates  ON public.audit_planning(planned_from, planned_to);

ALTER TABLE public.audit_planning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_members_audit_planning"
  ON public.audit_planning FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));


-- ── 2. audit_communication ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_communication (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id             UUID        REFERENCES public.firms(id)           ON DELETE CASCADE,
  planning_id         UUID        REFERENCES public.audit_planning(id)  ON DELETE CASCADE,
  client_name         TEXT,
  audit_planned_from  DATE,
  audit_planned_to    DATE,
  contact_person      TEXT,
  contact_no          TEXT,
  remarks             TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ac_firm     ON public.audit_communication(firm_id);
CREATE INDEX IF NOT EXISTS idx_ac_planning ON public.audit_communication(planning_id);

ALTER TABLE public.audit_communication ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_members_audit_communication"
  ON public.audit_communication FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));


-- ── 3. audit_status ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_status (
  id                              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id                         UUID        REFERENCES public.firms(id)              ON DELETE CASCADE,
  client_id                       UUID        REFERENCES public.clients(id)            ON DELETE SET NULL,
  party_name                      TEXT,
  physical_audit_conducted        TEXT        DEFAULT 'No',
  accounting_data                 TEXT        DEFAULT 'No',
  audit_employees                 TEXT,
  audit_report_prepared_by        TEXT,
  audit_status                    TEXT,
  audit_status_other              TEXT,
  report_print_date               DATE,
  firm                            TEXT,
  partner                         TEXT,
  udin_tax_audit                  TEXT,
  udin_statutory_audit            TEXT,
  udin_date                       DATE,
  physical_report_received_date   DATE,
  scanned                         TEXT        DEFAULT 'No',
  prepared_by                     TEXT,
  checked_by                      TEXT,
  uploaded_by                     TEXT,
  remarks                         TEXT,
  engagement_id                   UUID        REFERENCES public.audit_engagements(id) ON DELETE SET NULL,
  created_at                      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_as_firm   ON public.audit_status(firm_id);
CREATE INDEX IF NOT EXISTS idx_as_client ON public.audit_status(client_id);

ALTER TABLE public.audit_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_members_audit_status"
  ON public.audit_status FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));
