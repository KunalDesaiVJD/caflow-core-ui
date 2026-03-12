
-- Role theme overrides table
CREATE TABLE IF NOT EXISTS public.role_theme_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id UUID REFERENCES public.firms(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL,
  theme_id UUID REFERENCES public.app_themes(id) ON DELETE SET NULL,
  layout_type TEXT DEFAULT 'sidebar_classic',
  color_scheme TEXT DEFAULT 'midnight_professional',
  allow_user_override BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(firm_id, role)
);

ALTER TABLE public.role_theme_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmin or firm_admin can manage role_theme_overrides"
  ON public.role_theme_overrides FOR ALL
  TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

-- Add default_for_roles to app_themes
ALTER TABLE public.app_themes ADD COLUMN IF NOT EXISTS default_for_roles JSONB DEFAULT '{}';

-- Add bundle_url to audit_engagements
ALTER TABLE public.audit_engagements ADD COLUMN IF NOT EXISTS bundle_url TEXT;
