-- CP-16: Audit Worksheet — Version History
-- Records who changed what section and when across all Stage-6 tabs.

CREATE TABLE IF NOT EXISTS public.audit_worksheet_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  section_name    TEXT NOT NULL,          -- e.g. "Audit Worksheet", "Checklist"
  page_label      TEXT,                   -- e.g. "Clause 21(b)", "Working Paper 3"
  field_name      TEXT,                   -- specific field that changed (optional)
  old_value       TEXT,
  new_value       TEXT,
  changed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name TEXT,                   -- denormalized for display speed
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast per-engagement lookups (most common query)
CREATE INDEX IF NOT EXISTS audit_worksheet_history_engagement_idx
  ON public.audit_worksheet_history (engagement_id, changed_at DESC);

-- RLS
ALTER TABLE public.audit_worksheet_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_members_read_worksheet_history"
  ON public.audit_worksheet_history FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.audit_engagements ae
      JOIN  public.users u ON u.firm_id = ae.firm_id
      WHERE ae.id = audit_worksheet_history.engagement_id
        AND u.id  = auth.uid()
    )
  );

CREATE POLICY "firm_members_insert_worksheet_history"
  ON public.audit_worksheet_history FOR INSERT TO authenticated
  WITH CHECK (
    is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.audit_engagements ae
      JOIN  public.users u ON u.firm_id = ae.firm_id
      WHERE ae.id = audit_worksheet_history.engagement_id
        AND u.id  = auth.uid()
    )
  );

COMMENT ON TABLE public.audit_worksheet_history IS
  'CP-16: Append-only audit trail for all Stage-6 (Audit Worksheet) saves. '
  'One row per explicit manualSave() call, per section.';
