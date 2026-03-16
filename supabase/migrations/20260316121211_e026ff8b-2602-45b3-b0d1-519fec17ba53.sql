
CREATE TABLE IF NOT EXISTS public.notes_rollover_buffer (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID,
  firm_id UUID,
  from_financial_year TEXT,
  to_financial_year TEXT,
  rolled_notes JSONB,
  applied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rollover_client_fy ON public.notes_rollover_buffer(client_id, to_financial_year);

ALTER TABLE public.notes_rollover_buffer ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view rollover for their firm" ON public.notes_rollover_buffer
  FOR SELECT TO authenticated
  USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());

CREATE POLICY "Users can insert rollover for their firm" ON public.notes_rollover_buffer
  FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());

CREATE POLICY "Users can update rollover for their firm" ON public.notes_rollover_buffer
  FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
