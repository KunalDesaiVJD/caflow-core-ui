
-- Add RLS policies for itr_demands table
ALTER TABLE public.itr_demands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm select itr_demands" ON public.itr_demands
  FOR SELECT TO authenticated
  USING (is_superadmin() OR (client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));

CREATE POLICY "Firm insert itr_demands" ON public.itr_demands
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));

CREATE POLICY "Firm update itr_demands" ON public.itr_demands
  FOR UPDATE TO authenticated
  USING (is_superadmin() OR (client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));

CREATE POLICY "Firm delete itr_demands" ON public.itr_demands
  FOR DELETE TO authenticated
  USING (is_superadmin() OR (client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));
