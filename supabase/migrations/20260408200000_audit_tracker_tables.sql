-- ─────────────────────────────────────────────────────────────────────────────
-- Audit Tracker Module — three tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. audit_planning  — calendar-based planning entries
-- 2. audit_communication — communication log per planning entry
-- 3. audit_status — per-engagement tracker extension (UDIN, fees, remarks)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. audit_planning ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_planning (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id             UUID        REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id           UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  engagement_id       UUID        REFERENCES public.audit_engagements(id) ON DELETE SET NULL,
  financial_year      TEXT,
  audit_type          TEXT,           -- tax_audit | statutory | both | internal | stock
  audit_firm_id       UUID        REFERENCES public.audit_firms(id) ON DELETE SET NULL,
  partner_id          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  manager_id          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  planned_start       DATE,
  planned_end         DATE,
  actual_start        DATE,
  actual_end          DATE,
  status              TEXT        NOT NULL DEFAULT 'planned',
    -- planned | in_progress | completed | delayed | cancelled
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  created_by          UUID        REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_planning_firm      ON public.audit_planning(firm_id);
CREATE INDEX IF NOT EXISTS idx_audit_planning_client    ON public.audit_planning(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_planning_dates     ON public.audit_planning(planned_start, planned_end);

ALTER TABLE public.audit_planning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members can manage audit_planning"
  ON public.audit_planning
  FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));


-- ── 2. audit_communication ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_communication (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id             UUID        REFERENCES public.firms(id) ON DELETE CASCADE,
  planning_id         UUID        REFERENCES public.audit_planning(id) ON DELETE CASCADE,
  client_id           UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  contact_name        TEXT,
  contact_phone       TEXT,
  contact_email       TEXT,
  communication_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  communication_type  TEXT        NOT NULL DEFAULT 'call',
    -- call | email | meeting | letter | whatsapp
  subject             TEXT,
  notes               TEXT,
  follow_up_date      DATE,
  created_at          TIMESTAMPTZ DEFAULT now(),
  created_by          UUID        REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_comm_planning  ON public.audit_communication(planning_id);
CREATE INDEX IF NOT EXISTS idx_audit_comm_client    ON public.audit_communication(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_comm_firm      ON public.audit_communication(firm_id);

ALTER TABLE public.audit_communication ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members can manage audit_communication"
  ON public.audit_communication
  FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));


-- ── 3. audit_status ──────────────────────────────────────────────────────────
-- Extension table — one row per engagement, stores the extra tracker fields
-- that audit_engagements doesn't have (udin_statutory, fees, tracker_status)
CREATE TABLE IF NOT EXISTS public.audit_status (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id             UUID        REFERENCES public.firms(id) ON DELETE CASCADE,
  engagement_id       UUID        REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  client_id           UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  financial_year      TEXT,
  fees_quoted         NUMERIC(12,2),
  fees_received       NUMERIC(12,2),
  udin_tax            TEXT,           -- UDIN for 3CA/3CB (tax audit) — all entity types
  udin_statutory      TEXT,           -- UDIN for Statutory Audit — companies only
  tracker_status      TEXT        NOT NULL DEFAULT 'not_started',
    -- not_started | in_progress | review | completed | signed
  remarks             TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT audit_status_engagement_unique UNIQUE (engagement_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_status_firm        ON public.audit_status(firm_id);
CREATE INDEX IF NOT EXISTS idx_audit_status_engagement  ON public.audit_status(engagement_id);

ALTER TABLE public.audit_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm members can manage audit_status"
  ON public.audit_status
  FOR ALL TO authenticated
  USING  (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

-- auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER audit_status_updated_at
  BEFORE UPDATE ON public.audit_status
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
