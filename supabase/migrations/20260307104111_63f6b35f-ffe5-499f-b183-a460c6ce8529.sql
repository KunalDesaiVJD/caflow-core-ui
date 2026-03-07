-- RLS policies for invoices table
CREATE POLICY "Firm select invoices" ON public.invoices FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "Firm insert invoices" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "Firm update invoices" ON public.invoices FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "Firm delete invoices" ON public.invoices FOR DELETE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());

-- RLS policies for timesheets table
CREATE POLICY "Firm select timesheets" ON public.timesheets FOR SELECT TO authenticated
  USING (is_superadmin() OR user_id = auth.uid());

CREATE POLICY "Firm insert timesheets" ON public.timesheets FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR user_id = auth.uid());

CREATE POLICY "Firm update timesheets" ON public.timesheets FOR UPDATE TO authenticated
  USING (is_superadmin() OR user_id = auth.uid());

-- RLS policies for audit_engagements (add missing insert/update)
CREATE POLICY "Firm insert audit_engagements" ON public.audit_engagements FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "Firm update audit_engagements" ON public.audit_engagements FOR UPDATE TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());