
-- Human action tracking for AI learning
CREATE TABLE public.audit_human_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  user_id uuid,
  firm_id uuid REFERENCES public.firms(id),
  action_type text NOT NULL,
  action_context jsonb DEFAULT '{}',
  ai_suggestion text,
  human_override boolean DEFAULT false,
  session_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_human_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON public.audit_human_actions
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON public.audit_human_actions
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

-- AI Skills table (superadmin managed)
CREATE TABLE public.audit_ai_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  pattern_name text,
  skill_data jsonb NOT NULL DEFAULT '{}',
  entity_type text,
  example_before text,
  example_after text,
  action_count integer DEFAULT 0,
  firms_affected integer DEFAULT 0,
  active boolean DEFAULT false,
  approved_by uuid,
  approved_at timestamptz,
  applied_count integer DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_ai_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_select" ON public.audit_ai_skills
  FOR SELECT TO authenticated
  USING (is_superadmin());

CREATE POLICY "superadmin_insert" ON public.audit_ai_skills
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());

CREATE POLICY "superadmin_update" ON public.audit_ai_skills
  FOR UPDATE TO authenticated
  USING (is_superadmin());

CREATE POLICY "superadmin_delete" ON public.audit_ai_skills
  FOR DELETE TO authenticated
  USING (is_superadmin());

-- Allow reading active skills for all authenticated users (for skill application)
CREATE POLICY "read_active_skills" ON public.audit_ai_skills
  FOR SELECT TO authenticated
  USING (active = true);
