
-- Add reference_no to invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS reference_no TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS place_of_supply TEXT;

-- Create item description master table
CREATE TABLE IF NOT EXISTS public.invoice_item_masters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id UUID REFERENCES public.firms(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  hsn_sac_code TEXT,
  default_rate NUMERIC,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.invoice_item_masters ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "firm_scope_select" ON public.invoice_item_masters
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON public.invoice_item_masters
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_update" ON public.invoice_item_masters
  FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_delete" ON public.invoice_item_masters
  FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());
