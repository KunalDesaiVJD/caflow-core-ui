
-- Add new client fields for email, mobile, address, classification
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS mobile text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_classification jsonb DEFAULT '[]'::jsonb;

-- Add package field to service_categories
ALTER TABLE public.service_categories ADD COLUMN IF NOT EXISTS package text;

-- Create work_groups table (same structure as client_groups)
CREATE TABLE IF NOT EXISTS public.work_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text,
  firm_id uuid NOT NULL REFERENCES public.firms(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.work_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view work groups in their firm"
  ON public.work_groups FOR SELECT
  TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can insert work groups in their firm"
  ON public.work_groups FOR INSERT
  TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can update work groups in their firm"
  ON public.work_groups FOR UPDATE
  TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can delete work groups in their firm"
  ON public.work_groups FOR DELETE
  TO authenticated
  USING (firm_id = public.current_user_firm_id());

-- Work group memberships (link clients to work groups)
CREATE TABLE IF NOT EXISTS public.work_group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id),
  added_at timestamptz DEFAULT now(),
  UNIQUE(group_id, client_id)
);

ALTER TABLE public.work_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view work group memberships"
  ON public.work_group_memberships FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.work_groups wg
    WHERE wg.id = group_id AND wg.firm_id = public.current_user_firm_id()
  ));

CREATE POLICY "Users can manage work group memberships"
  ON public.work_group_memberships FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.work_groups wg
    WHERE wg.id = group_id AND wg.firm_id = public.current_user_firm_id()
  ));

CREATE POLICY "Users can delete work group memberships"
  ON public.work_group_memberships FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.work_groups wg
    WHERE wg.id = group_id AND wg.firm_id = public.current_user_firm_id()
  ));
