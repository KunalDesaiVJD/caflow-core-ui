
-- Add columns to clients table
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS registered_office text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS business_activity text;

-- Create caro_master_templates table
CREATE TABLE public.caro_master_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id) ON DELETE CASCADE NOT NULL,
  clause_number integer NOT NULL,
  clause_title text,
  default_content text,
  is_applicable_default boolean DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(firm_id, clause_number)
);

-- Enable RLS
ALTER TABLE public.caro_master_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for caro_master_templates
CREATE POLICY "Users can view own firm caro templates"
  ON public.caro_master_templates FOR SELECT
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can insert own firm caro templates"
  ON public.caro_master_templates FOR INSERT
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can update own firm caro templates"
  ON public.caro_master_templates FOR UPDATE
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can delete own firm caro templates"
  ON public.caro_master_templates FOR DELETE
  USING (firm_id = public.current_user_firm_id());
