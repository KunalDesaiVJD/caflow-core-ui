-- Drop conflicting old policies on caro_master_templates
DROP POLICY IF EXISTS "Users can insert own firm caro templates" ON public.caro_master_templates;
DROP POLICY IF EXISTS "Users can update own firm caro templates" ON public.caro_master_templates;
DROP POLICY IF EXISTS "Users can delete own firm caro templates" ON public.caro_master_templates;
DROP POLICY IF EXISTS "Users can view own firm caro templates" ON public.caro_master_templates;
DROP POLICY IF EXISTS "Partners and admins can manage caro templates" ON public.caro_master_templates;
DROP POLICY IF EXISTS "Anyone authenticated can read caro templates" ON public.caro_master_templates;

-- Recreate clean global policies
CREATE POLICY "Authenticated users can read caro templates"
ON public.caro_master_templates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Partners and admins can insert caro templates"
ON public.caro_master_templates FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('partner', 'admin', 'superadmin'))
);

CREATE POLICY "Partners and admins can update caro templates"
ON public.caro_master_templates FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('partner', 'admin', 'superadmin'))
);

CREATE POLICY "Partners and admins can delete caro templates"
ON public.caro_master_templates FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('partner', 'admin', 'superadmin'))
);

-- Same for threecd_master_templates - fix if policies are too restrictive
DROP POLICY IF EXISTS "Authenticated users can read 3cd templates" ON public.threecd_master_templates;
DROP POLICY IF EXISTS "Partners and admins can manage 3cd templates" ON public.threecd_master_templates;

CREATE POLICY "Authenticated users can read 3cd templates"
ON public.threecd_master_templates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Partners and admins can insert 3cd templates"
ON public.threecd_master_templates FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('partner', 'admin', 'superadmin'))
);

CREATE POLICY "Partners and admins can update 3cd templates"
ON public.threecd_master_templates FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('partner', 'admin', 'superadmin'))
);

CREATE POLICY "Partners and admins can delete 3cd templates"
ON public.threecd_master_templates FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('partner', 'admin', 'superadmin'))
);