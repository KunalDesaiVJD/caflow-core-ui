
CREATE POLICY "Users can insert clients for their firm"
ON public.clients FOR INSERT TO authenticated
WITH CHECK (
  firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
);

CREATE POLICY "Users can read clients for their firm"
ON public.clients FOR SELECT TO authenticated
USING (
  firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
);

CREATE POLICY "Users can update clients for their firm"
ON public.clients FOR UPDATE TO authenticated
USING (
  firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
)
WITH CHECK (
  firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
);
