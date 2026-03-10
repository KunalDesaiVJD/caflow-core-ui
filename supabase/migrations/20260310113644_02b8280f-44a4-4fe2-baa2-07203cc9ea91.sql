
CREATE TABLE public.app_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  layout_type text NOT NULL DEFAULT 'sidebar_classic',
  color_scheme text NOT NULL DEFAULT 'midnight_professional',
  css_vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_select" ON public.app_themes FOR SELECT TO authenticated USING (is_superadmin());
CREATE POLICY "superadmin_insert" ON public.app_themes FOR INSERT TO authenticated WITH CHECK (is_superadmin());
CREATE POLICY "superadmin_update" ON public.app_themes FOR UPDATE TO authenticated USING (is_superadmin());
CREATE POLICY "superadmin_delete" ON public.app_themes FOR DELETE TO authenticated USING (is_superadmin());
CREATE POLICY "read_active_themes" ON public.app_themes FOR SELECT TO authenticated USING (active = true);

-- Seed default themes
INSERT INTO public.app_themes (name, layout_type, color_scheme, css_vars, is_default) VALUES
('Midnight Professional - Sidebar Classic', 'sidebar_classic', 'midnight_professional',
 '{"--bg-primary":"220 14% 7%","--bg-secondary":"215 19% 13%","--text-primary":"210 40% 98%","--text-secondary":"215 20% 65%","--accent":"42 52% 54%","--sidebar-bg":"215 19% 13%"}'::jsonb,
 true),
('Clean White - Sidebar Classic', 'sidebar_classic', 'clean_white',
 '{"--bg-primary":"0 0% 100%","--bg-secondary":"210 40% 98%","--text-primary":"222 47% 11%","--text-secondary":"215 16% 47%","--accent":"174 68% 32%","--sidebar-bg":"210 40% 98%"}'::jsonb,
 false),
('Sage Green - Sidebar Classic', 'sidebar_classic', 'sage_green',
 '{"--bg-primary":"80 20% 97%","--bg-secondary":"100 18% 92%","--text-primary":"24 10% 10%","--text-secondary":"25 7% 32%","--accent":"40 35% 37%","--sidebar-bg":"100 18% 92%"}'::jsonb,
 false);
