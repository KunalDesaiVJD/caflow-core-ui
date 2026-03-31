
CREATE TABLE public.coa_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL,
  level integer NOT NULL DEFAULT 4,
  major_group text,
  group_name text,
  sub_group text,
  account_head text NOT NULL,
  account_type text,
  normal_balance text,
  bs_pl text,
  fs_line_item text,
  note_no text,
  applicable_entities text,
  tally_group_mapping text,
  remarks text,
  entity_type text NOT NULL DEFAULT 'corporate',
  firm_id uuid REFERENCES public.firms(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_code, entity_type, firm_id)
);

ALTER TABLE public.coa_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read coa_master for their firm or global"
  ON public.coa_master FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = public.current_user_firm_id());

CREATE POLICY "Firm admins can insert coa_master"
  ON public.coa_master FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "Firm admins can update own coa_master"
  ON public.coa_master FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Firm admins can delete own coa_master"
  ON public.coa_master FOR DELETE TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE INDEX idx_coa_master_entity ON public.coa_master(entity_type);
CREATE INDEX idx_coa_master_firm ON public.coa_master(firm_id);
CREATE INDEX idx_coa_master_level ON public.coa_master(level);
