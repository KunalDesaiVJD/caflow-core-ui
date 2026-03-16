CREATE TABLE IF NOT EXISTS public.form_3cd (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE CASCADE,
  firm_id UUID,
  client_id UUID,
  financial_year TEXT,
  assessment_year TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','complete','locked')),
  last_saved_at TIMESTAMPTZ,
  last_saved_by UUID,
  cl_8  JSONB DEFAULT '{}',
  cl_9  JSONB DEFAULT '{}',
  cl_10 JSONB DEFAULT '{}',
  cl_11 JSONB DEFAULT '{}',
  cl_12 JSONB DEFAULT '{}',
  cl_13 JSONB DEFAULT '{}',
  cl_14 JSONB DEFAULT '{}',
  cl_15_16 JSONB DEFAULT '{}',
  cl_17 JSONB DEFAULT '{}',
  cl_18 JSONB DEFAULT '{}',
  cl_19 JSONB DEFAULT '{}',
  cl_20 JSONB DEFAULT '{}',
  cl_21 JSONB DEFAULT '{}',
  cl_22 JSONB DEFAULT '{}',
  cl_23 JSONB DEFAULT '{}',
  cl_24_25 JSONB DEFAULT '{}',
  cl_26 JSONB DEFAULT '{}',
  cl_27 JSONB DEFAULT '{}',
  cl_29 JSONB DEFAULT '{}',
  cl_30 JSONB DEFAULT '{}',
  cl_31 JSONB DEFAULT '{}',
  cl_32 JSONB DEFAULT '{}',
  cl_33 JSONB DEFAULT '{}',
  cl_34 JSONB DEFAULT '{}',
  cl_35 JSONB DEFAULT '{}',
  cl_36 JSONB DEFAULT '{}',
  cl_37_39 JSONB DEFAULT '{}',
  cl_40 JSONB DEFAULT '{}',
  cl_41 JSONB DEFAULT '{}',
  cl_42_43 JSONB DEFAULT '{}',
  cl_44 JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_form3cd_engagement ON public.form_3cd(engagement_id);

ALTER TABLE public.form_3cd ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON public.form_3cd FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON public.form_3cd FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_update" ON public.form_3cd FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_delete" ON public.form_3cd FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());