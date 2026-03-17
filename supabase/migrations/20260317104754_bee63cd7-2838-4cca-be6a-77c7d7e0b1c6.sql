
-- Create 3CD master templates table
CREATE TABLE public.threecd_master_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_number text NOT NULL,
  heading text,
  template_content text DEFAULT '',
  is_applicable_default boolean DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(clause_number)
);

ALTER TABLE public.threecd_master_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read 3cd templates"
  ON public.threecd_master_templates FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Partners and admins can manage 3cd templates"
  ON public.threecd_master_templates FOR ALL
  TO authenticated USING (
    public.current_user_role() IN ('partner', 'admin', 'superadmin')
  ) WITH CHECK (
    public.current_user_role() IN ('partner', 'admin', 'superadmin')
  );

-- Update CARO master templates: drop firm_id unique constraint, add global unique
ALTER TABLE public.caro_master_templates DROP CONSTRAINT IF EXISTS caro_master_templates_firm_id_clause_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS caro_master_templates_clause_number_unique ON public.caro_master_templates (clause_number) WHERE firm_id IS NULL;

-- Update RLS on caro_master_templates to allow global access
DROP POLICY IF EXISTS "Users can view caro templates for their firm" ON public.caro_master_templates;
DROP POLICY IF EXISTS "Partners can manage caro templates" ON public.caro_master_templates;

CREATE POLICY "Anyone authenticated can read caro templates"
  ON public.caro_master_templates FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Partners and admins can manage caro templates"
  ON public.caro_master_templates FOR ALL
  TO authenticated USING (
    public.current_user_role() IN ('partner', 'admin', 'superadmin')
  ) WITH CHECK (
    public.current_user_role() IN ('partner', 'admin', 'superadmin')
  );
