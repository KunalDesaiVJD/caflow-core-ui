CREATE TABLE public.notes_selection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES public.audit_engagements(id) ON DELETE CASCADE NOT NULL UNIQUE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year text,
  selected_notes jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.notes_selection ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read notes_selection"
ON public.notes_selection FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert notes_selection"
ON public.notes_selection FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update notes_selection"
ON public.notes_selection FOR UPDATE TO authenticated USING (true);