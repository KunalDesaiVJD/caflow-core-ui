
CREATE TABLE IF NOT EXISTS public.notes_to_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE CASCADE,
  firm_id UUID,
  client_id UUID,
  financial_year TEXT,
  status TEXT DEFAULT 'draft',
  last_saved_at TIMESTAMPTZ,
  note_1 JSONB DEFAULT '{}',
  note_2 JSONB DEFAULT '{}',
  note_29 JSONB DEFAULT '{}',
  note_30 JSONB DEFAULT '{}',
  note_31 JSONB DEFAULT '{}',
  note_32 JSONB DEFAULT '{}',
  note_33 JSONB DEFAULT '{}',
  note_34 JSONB DEFAULT '{}',
  note_35 JSONB DEFAULT '{}',
  note_36 JSONB DEFAULT '{}',
  note_37 JSONB DEFAULT '{}',
  note_38 JSONB DEFAULT '{}',
  note_39 JSONB DEFAULT '{}',
  note_40 JSONB DEFAULT '{}',
  note_41 JSONB DEFAULT '{}',
  note_42 JSONB DEFAULT '{}',
  note_43 JSONB DEFAULT '{}',
  note_44 JSONB DEFAULT '{}',
  note_45 JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_engagement ON public.notes_to_accounts(engagement_id);

ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS notes_finalized BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes_finalized_at TIMESTAMPTZ;

-- RLS policies
ALTER TABLE public.notes_to_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view notes for their firm" ON public.notes_to_accounts
  FOR SELECT TO authenticated
  USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());

CREATE POLICY "Users can insert notes for their firm" ON public.notes_to_accounts
  FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());

CREATE POLICY "Users can update notes for their firm" ON public.notes_to_accounts
  FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
