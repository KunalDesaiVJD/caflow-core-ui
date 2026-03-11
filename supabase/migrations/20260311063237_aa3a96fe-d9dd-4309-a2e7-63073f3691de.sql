
-- TASK 1: Extend firms table with merged audit_firms fields
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS gstin TEXT,
  ADD COLUMN IF NOT EXISTS tan TEXT,
  ADD COLUMN IF NOT EXISTS icai_firm_reg_no TEXT,
  ADD COLUMN IF NOT EXISTS address JSONB,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS membership_numbers JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS peer_review_certificate_no TEXT,
  ADD COLUMN IF NOT EXISTS peer_review_valid_till DATE,
  ADD COLUMN IF NOT EXISTS bank_details JSONB,
  ADD COLUMN IF NOT EXISTS letterhead_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS is_audit_firm BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_theme_id UUID REFERENCES app_themes(id),
  ADD COLUMN IF NOT EXISTS invoice_template_id TEXT,
  ADD COLUMN IF NOT EXISTS primary_color TEXT,
  ADD COLUMN IF NOT EXISTS secondary_color TEXT,
  ADD COLUMN IF NOT EXISTS plan_type TEXT,
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_clients INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS features_enabled JSONB DEFAULT '{}'::jsonb;

-- TASK 2: Create role_permissions table
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('superadmin','firm_admin','partner_ca','manager','staff_article','client')),
  module TEXT NOT NULL,
  can_view BOOLEAN DEFAULT false,
  can_create BOOLEAN DEFAULT false,
  can_edit BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  can_export BOOLEAN DEFAULT false,
  custom_restrictions JSONB DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(firm_id, role, module)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rp_select" ON public.role_permissions FOR SELECT TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "rp_insert" ON public.role_permissions FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id() AND current_user_role() = 'firm_admin'));

CREATE POLICY "rp_update" ON public.role_permissions FOR UPDATE TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id() AND current_user_role() = 'firm_admin'));

CREATE POLICY "rp_delete" ON public.role_permissions FOR DELETE TO authenticated
  USING (is_superadmin());

-- Create role_permission_audit_log table
CREATE TABLE IF NOT EXISTS public.role_permission_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID REFERENCES firms(id),
  role TEXT NOT NULL,
  module TEXT NOT NULL,
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.role_permission_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpal_select" ON public.role_permission_audit_log FOR SELECT TO authenticated
  USING (is_superadmin() OR (firm_id = current_user_firm_id()));

CREATE POLICY "rpal_insert" ON public.role_permission_audit_log FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (firm_id = current_user_firm_id()));
