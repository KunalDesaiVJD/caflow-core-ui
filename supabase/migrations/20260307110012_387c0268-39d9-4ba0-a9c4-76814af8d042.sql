
-- Allow firm members to read bank_reconciliations for their clients
CREATE POLICY "Firm select bank_reconciliations" ON public.bank_reconciliations
FOR SELECT TO authenticated
USING (is_superadmin() OR client_id IN (
  SELECT id FROM public.clients WHERE firm_id = current_user_firm_id()
));

CREATE POLICY "Firm insert bank_reconciliations" ON public.bank_reconciliations
FOR INSERT TO authenticated
WITH CHECK (is_superadmin() OR client_id IN (
  SELECT id FROM public.clients WHERE firm_id = current_user_firm_id()
));

CREATE POLICY "Firm update bank_reconciliations" ON public.bank_reconciliations
FOR UPDATE TO authenticated
USING (is_superadmin() OR client_id IN (
  SELECT id FROM public.clients WHERE firm_id = current_user_firm_id()
));

CREATE POLICY "Firm delete bank_reconciliations" ON public.bank_reconciliations
FOR DELETE TO authenticated
USING (is_superadmin() OR client_id IN (
  SELECT id FROM public.clients WHERE firm_id = current_user_firm_id()
));

-- Allow timesheet delete for own entries
CREATE POLICY "User delete own timesheets" ON public.timesheets
FOR DELETE TO authenticated
USING (is_superadmin() OR user_id = auth.uid());
