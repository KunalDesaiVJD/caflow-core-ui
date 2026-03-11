
-- Create invoice_line_items table
CREATE TABLE public.invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hsn_sac_code TEXT,
  quantity NUMERIC(12,2) DEFAULT 1,
  unit TEXT,
  rate NUMERIC(12,2) DEFAULT 0,
  amount NUMERIC(12,2) DEFAULT 0,
  tax_rate_cgst NUMERIC(5,2) DEFAULT 0,
  tax_rate_sgst NUMERIC(5,2) DEFAULT 0,
  tax_rate_igst NUMERIC(5,2) DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS for invoice_line_items
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON public.invoice_line_items FOR SELECT TO authenticated
USING (is_superadmin() OR invoice_id IN (SELECT id FROM invoices WHERE firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_insert" ON public.invoice_line_items FOR INSERT TO authenticated
WITH CHECK (is_superadmin() OR invoice_id IN (SELECT id FROM invoices WHERE firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_update" ON public.invoice_line_items FOR UPDATE TO authenticated
USING (is_superadmin() OR invoice_id IN (SELECT id FROM invoices WHERE firm_id = current_user_firm_id()));

CREATE POLICY "firm_scope_delete" ON public.invoice_line_items FOR DELETE TO authenticated
USING (is_superadmin() OR invoice_id IN (SELECT id FROM invoices WHERE firm_id = current_user_firm_id()));

-- Add new columns to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_format TEXT DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_cgst NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sgst NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_igst NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS bank_details_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS footer_text TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS is_intra_state BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS voided_reason TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS invoice_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS from_firm_name TEXT,
  ADD COLUMN IF NOT EXISTS from_address TEXT,
  ADD COLUMN IF NOT EXISTS from_gstin TEXT,
  ADD COLUMN IF NOT EXISTS from_pan TEXT,
  ADD COLUMN IF NOT EXISTS from_phone TEXT,
  ADD COLUMN IF NOT EXISTS from_email TEXT,
  ADD COLUMN IF NOT EXISTS to_name TEXT,
  ADD COLUMN IF NOT EXISTS to_address TEXT,
  ADD COLUMN IF NOT EXISTS to_gstin TEXT,
  ADD COLUMN IF NOT EXISTS to_pan TEXT,
  ADD COLUMN IF NOT EXISTS show_logo BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS signatory_name TEXT;

-- Add new columns to timesheets
ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES public.firms(id),
  ADD COLUMN IF NOT EXISTS service_category_id UUID REFERENCES public.service_categories(id),
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_invoiced BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ADD COLUMN IF NOT EXISTS minutes INTEGER DEFAULT 0;
