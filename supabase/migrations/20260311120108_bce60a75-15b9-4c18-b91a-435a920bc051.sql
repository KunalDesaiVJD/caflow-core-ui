-- Stage 8: CARO 2020 responses table
CREATE TABLE IF NOT EXISTS public.audit_caro_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  clause_number integer NOT NULL CHECK (clause_number BETWEEN 1 AND 21),
  clause_title varchar NOT NULL,
  auto_draft text,
  user_response text,
  status varchar NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','drafted','reviewed','approved','locked')),
  is_applicable boolean NOT NULL DEFAULT true,
  inapplicability_reason text,
  is_locked boolean NOT NULL DEFAULT false,
  last_updated_by uuid,
  last_updated_at timestamptz DEFAULT now(),
  UNIQUE(engagement_id, clause_number)
);

ALTER TABLE public.audit_caro_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage CARO responses for their firm engagements"
ON public.audit_caro_responses FOR ALL TO authenticated
USING (
  engagement_id IN (
    SELECT id FROM public.audit_engagements WHERE firm_id = current_user_firm_id()
  )
  OR is_superadmin()
);

-- Stage 9: 3CD responses table
CREATE TABLE IF NOT EXISTS public.audit_3cd_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  clause_number integer NOT NULL CHECK (clause_number BETWEEN 1 AND 44),
  clause_sub varchar,
  auto_value text,
  user_value text,
  is_applicable boolean NOT NULL DEFAULT true,
  is_locked boolean NOT NULL DEFAULT false,
  last_updated_by uuid,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(engagement_id, clause_number, clause_sub)
);

ALTER TABLE public.audit_3cd_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage 3CD responses for their firm engagements"
ON public.audit_3cd_responses FOR ALL TO authenticated
USING (
  engagement_id IN (
    SELECT id FROM public.audit_engagements WHERE firm_id = current_user_firm_id()
  )
  OR is_superadmin()
);