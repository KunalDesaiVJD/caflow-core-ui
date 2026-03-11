
-- ═══════════════════════════════════════════════════════════
-- TASK 1: Service Category Masters
-- ═══════════════════════════════════════════════════════════

CREATE TABLE public.service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  category_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL DEFAULT 'annual' CHECK (frequency IN ('monthly','quarterly','half_yearly','annual','event_based')),
  default_due_day INTEGER CHECK (default_due_day >= 1 AND default_due_day <= 31),
  applicable_entity_types JSONB DEFAULT '[]'::jsonb,
  linked_module TEXT CHECK (linked_module IN ('itr','tds','gst','audit','billing','depreciation','roc','payroll','bookkeeping','custom')),
  default_fee_template JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(firm_id, category_code)
);

CREATE TABLE public.service_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  default_description TEXT,
  default_rate NUMERIC(12,2),
  hsn_sac_code TEXT,
  tax_rate NUMERIC(5,2) DEFAULT 18.00,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- TASK 2: Client Services activation table
CREATE TABLE public.client_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  frequency_override TEXT CHECK (frequency_override IS NULL OR frequency_override IN ('monthly','quarterly','half_yearly','annual','event_based')),
  due_date_override INTEGER CHECK (due_date_override IS NULL OR (due_date_override >= 1 AND due_date_override <= 31)),
  assigned_staff JSONB DEFAULT '[]'::jsonb,
  fee_override NUMERIC(12,2),
  activated_at TIMESTAMPTZ DEFAULT now(),
  deactivated_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(client_id, service_category_id)
);

-- Add audit setup columns to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS statutory_audit_applicable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_audit_type TEXT,
  ADD COLUMN IF NOT EXISTS caro_applicable BOOLEAN,
  ADD COLUMN IF NOT EXISTS internal_audit_applicable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_audit_applicable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_config JSONB DEFAULT '{}'::jsonb;

-- RLS for service_categories
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sc_select" ON public.service_categories FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "sc_insert" ON public.service_categories FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "sc_update" ON public.service_categories FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "sc_delete" ON public.service_categories FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

-- RLS for service_templates
ALTER TABLE public.service_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "st_select" ON public.service_templates FOR SELECT TO authenticated
  USING (is_superadmin() OR service_category_id IN (SELECT id FROM service_categories WHERE firm_id = current_user_firm_id()));
CREATE POLICY "st_insert" ON public.service_templates FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR service_category_id IN (SELECT id FROM service_categories WHERE firm_id = current_user_firm_id()));
CREATE POLICY "st_update" ON public.service_templates FOR UPDATE TO authenticated
  USING (is_superadmin() OR service_category_id IN (SELECT id FROM service_categories WHERE firm_id = current_user_firm_id()));
CREATE POLICY "st_delete" ON public.service_templates FOR DELETE TO authenticated
  USING (is_superadmin() OR service_category_id IN (SELECT id FROM service_categories WHERE firm_id = current_user_firm_id()));

-- RLS for client_services
ALTER TABLE public.client_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cs_select" ON public.client_services FOR SELECT TO authenticated
  USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "cs_insert" ON public.client_services FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "cs_update" ON public.client_services FOR UPDATE TO authenticated
  USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "cs_delete" ON public.client_services FOR DELETE TO authenticated
  USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
