
-- Allow authenticated users to insert into client_profiles for clients in their firm
CREATE POLICY "Users can insert client_profiles for their firm clients"
ON public.client_profiles FOR INSERT TO authenticated
WITH CHECK (
  client_id IN (SELECT id FROM public.clients WHERE firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
);

CREATE POLICY "Users can read client_profiles for their firm clients"
ON public.client_profiles FOR SELECT TO authenticated
USING (
  client_id IN (SELECT id FROM public.clients WHERE firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
);

CREATE POLICY "Users can update client_profiles for their firm clients"
ON public.client_profiles FOR UPDATE TO authenticated
USING (
  client_id IN (SELECT id FROM public.clients WHERE firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
)
WITH CHECK (
  client_id IN (SELECT id FROM public.clients WHERE firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
);
