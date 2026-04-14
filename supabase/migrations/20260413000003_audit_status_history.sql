-- ISSUE-19c: Row-level version history for audit_status
-- Stores full before/after snapshots on every UPDATE so users can track changes.

CREATE TABLE IF NOT EXISTS public.audit_status_history (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_status_id  UUID REFERENCES public.audit_status(id) ON DELETE CASCADE NOT NULL,
  changed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name  TEXT,
  changed_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  previous_data    JSONB,
  new_data         JSONB
);

CREATE INDEX IF NOT EXISTS idx_ash_status_id
  ON public.audit_status_history (audit_status_id);

CREATE INDEX IF NOT EXISTS idx_ash_changed_at
  ON public.audit_status_history (changed_at DESC);

ALTER TABLE public.audit_status_history ENABLE ROW LEVEL SECURITY;

-- Firm members can view history for rows they own
CREATE POLICY "Firm members can view audit_status_history"
  ON public.audit_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.audit_status s
      JOIN public.users u ON u.firm_id = s.firm_id
      WHERE s.id = audit_status_history.audit_status_id
        AND u.id = auth.uid()
    )
  );

-- Any authenticated user can insert (changed_by enforced in app layer)
CREATE POLICY "Authenticated users can insert audit_status_history"
  ON public.audit_status_history FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
