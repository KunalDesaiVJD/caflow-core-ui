CREATE TABLE IF NOT EXISTS public.tds_filing_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id uuid REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id uuid REFERENCES public.firms(id),
  form_type text,
  quarter text,
  financial_year text,
  old_status text,
  new_status text,
  changed_by uuid REFERENCES public.users(id),
  changed_at timestamptz DEFAULT now(),
  notes text
);

ALTER TABLE public.tds_filing_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their firm audit logs"
  ON public.tds_filing_audit_log FOR SELECT
  TO authenticated
  USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());

CREATE POLICY "Users can insert audit logs for their firm"
  ON public.tds_filing_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());