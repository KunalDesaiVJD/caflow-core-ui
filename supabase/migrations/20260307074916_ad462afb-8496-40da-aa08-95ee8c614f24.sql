
-- RLS policies for tds_entries (firm_id based access)
CREATE POLICY "Users can read tds_entries from their firm"
ON public.tds_entries FOR SELECT TO authenticated
USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

CREATE POLICY "Users can insert tds_entries to their firm"
ON public.tds_entries FOR INSERT TO authenticated
WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

CREATE POLICY "Users can update tds_entries from their firm"
ON public.tds_entries FOR UPDATE TO authenticated
USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()))
WITH CHECK (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));

CREATE POLICY "Users can delete tds_entries from their firm"
ON public.tds_entries FOR DELETE TO authenticated
USING (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid()));
