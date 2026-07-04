-- Scrutiny "Knowledge & Judgment" facts store (Phase 3).
--
-- Holds the ~30 human facts the engine can't derive (related parties, MSME status, physical
-- verification, management representations, ...), related-party nominations, and MSME/certificate
-- capture. One row per (client, FY, fact_type, fact_key); upsert on that key.
--
-- SAFETY: additive + idempotent (CREATE TABLE / INDEX / POLICY IF NOT EXISTS). Firm-scoped RLS
-- via client_id -> clients.firm_id, mirroring the tally RLS pattern (Ticket 0.4).
--
-- STATUS: authored, NOT applied. Apply to a DEV db only; never prod without review.

CREATE TABLE IF NOT EXISTS public.scrutiny_facts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text,
  engagement_id  uuid REFERENCES public.audit_engagements(id) ON DELETE SET NULL,
  firm_id        uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  -- general (a FACT_CATALOGUE key) | related_party (fact_key = party name) | msme | certificate
  fact_type      text NOT NULL DEFAULT 'general',
  fact_key       text NOT NULL,
  fact_value     text,
  note           text,
  captured_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at    timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- One value per fact per client/FY/type — enables upsert.
CREATE UNIQUE INDEX IF NOT EXISTS ux_scrutiny_facts_key
  ON public.scrutiny_facts (client_id, financial_year, fact_type, fact_key);

CREATE INDEX IF NOT EXISTS idx_scrutiny_facts_client_fy
  ON public.scrutiny_facts (client_id, financial_year);

ALTER TABLE public.scrutiny_facts ENABLE ROW LEVEL SECURITY;

-- Firm-scoped: an auditor sees/edits facts for clients in their firm (or superadmin).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrutiny_facts' AND policyname = 'scrutiny_facts_firm_scope') THEN
    CREATE POLICY scrutiny_facts_firm_scope ON public.scrutiny_facts
      FOR ALL
      USING (
        public.is_superadmin()
        OR client_id IN (SELECT id FROM public.clients WHERE firm_id = public.current_user_firm_id())
      )
      WITH CHECK (
        public.is_superadmin()
        OR client_id IN (SELECT id FROM public.clients WHERE firm_id = public.current_user_firm_id())
      );
  END IF;
END $$;

COMMENT ON TABLE public.scrutiny_facts IS
  'Scrutiny Knowledge & Judgment facts (Phase 3). fact_type: general (FACT_CATALOGUE key) | related_party (fact_key=party name) | msme | certificate. Keyed by client_id + financial_year + fact_type + fact_key. Gate-4 uses these advisory-only (never blocks sign-off).';
