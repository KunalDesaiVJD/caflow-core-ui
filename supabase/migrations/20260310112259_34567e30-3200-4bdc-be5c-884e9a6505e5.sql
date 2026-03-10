
-- Audit client queries table
CREATE TABLE public.audit_client_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id),
  firm_id uuid REFERENCES public.firms(id),
  ref_number text,
  query_text text NOT NULL,
  source text NOT NULL DEFAULT 'Manual',
  source_ref_id uuid,
  priority text NOT NULL DEFAULT 'Medium',
  status text NOT NULL DEFAULT 'Open',
  due_date date,
  client_reply text,
  replied_via text,
  reply_method text,
  internal_notes text,
  carry_forward_from_year text,
  carry_forward_to_year text,
  financial_year text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_client_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON public.audit_client_queries
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id() OR client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "firm_scope_insert" ON public.audit_client_queries
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id() OR client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "firm_scope_update" ON public.audit_client_queries
  FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id() OR client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "firm_scope_delete" ON public.audit_client_queries
  FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

-- Audit query dispatch log
CREATE TABLE public.audit_query_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES public.audit_engagements(id),
  client_id uuid REFERENCES public.clients(id),
  firm_id uuid REFERENCES public.firms(id),
  dispatch_ref text,
  query_ids uuid[] NOT NULL DEFAULT '{}',
  channel text NOT NULL,
  subject text,
  body text,
  template_used text,
  dispatched_by uuid,
  dispatched_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_query_dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_scope_select" ON public.audit_query_dispatch_log
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "firm_scope_insert" ON public.audit_query_dispatch_log
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
