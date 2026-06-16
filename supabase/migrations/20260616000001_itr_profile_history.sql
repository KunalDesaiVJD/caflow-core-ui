-- ──────────────────────────────────────────────────────────────────────────────
-- itr_profile_history
--
-- Per-row, per-field change log for the IT Returns grid. Auditor needs to see
-- every status / prepared-by / filed-date / etc. change with the user who made
-- it and when — same pattern as the Stage-2 Query Sheet edit log
-- (audit_worksheet_history). Keeps the journal anchored at the (client +
-- assessment_year + firm) triple rather than the itr_profiles row id, so
-- history survives even if a row gets deleted and re-created.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.itr_profile_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id         UUID,
  assessment_year TEXT NOT NULL,
  field_name      TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  changed_by      UUID,
  changed_by_name TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itr_profile_history_lookup
  ON public.itr_profile_history (client_id, assessment_year, changed_at DESC);

ALTER TABLE public.itr_profile_history ENABLE ROW LEVEL SECURITY;

-- Firm-scoped reads: members of the firm see their firm's history.
CREATE POLICY "Firm select itr_profile_history"
  ON public.itr_profile_history FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR firm_id = current_user_firm_id()
    OR firm_id IS NULL
  );

-- Authenticated inserts (RLS check happens via app — payload always carries
-- the writer's firm_id from the signed-in user record).
CREATE POLICY "Auth insert itr_profile_history"
  ON public.itr_profile_history FOR INSERT TO authenticated
  WITH CHECK (true);
