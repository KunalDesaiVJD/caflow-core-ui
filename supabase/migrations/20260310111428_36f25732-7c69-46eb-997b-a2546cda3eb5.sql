
-- Preliminary answers table
CREATE TABLE public.audit_preliminary_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id),
  firm_id uuid REFERENCES public.firms(id),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_tabs jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(engagement_id)
);

ALTER TABLE public.audit_preliminary_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON public.audit_preliminary_answers
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON public.audit_preliminary_answers
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_update" ON public.audit_preliminary_answers
  FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_delete" ON public.audit_preliminary_answers
  FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());
