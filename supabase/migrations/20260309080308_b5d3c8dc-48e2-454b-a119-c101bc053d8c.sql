-- RLS policies for documents table
CREATE POLICY "Firm select documents"
ON public.documents FOR SELECT TO authenticated
USING (
  is_superadmin() OR (firm_id = current_user_firm_id())
);

CREATE POLICY "Firm insert documents"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (
  is_superadmin() OR (firm_id = current_user_firm_id())
);

CREATE POLICY "Firm update documents"
ON public.documents FOR UPDATE TO authenticated
USING (
  is_superadmin() OR (firm_id = current_user_firm_id())
);

CREATE POLICY "Firm delete documents"
ON public.documents FOR DELETE TO authenticated
USING (
  is_superadmin() OR (firm_id = current_user_firm_id())
);