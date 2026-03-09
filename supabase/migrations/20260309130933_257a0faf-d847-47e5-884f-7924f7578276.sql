
ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS audit_type text DEFAULT 'statutory',
  ADD COLUMN IF NOT EXISTS planned_start date,
  ADD COLUMN IF NOT EXISTS planned_end date,
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS team_members uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS materiality jsonb,
  ADD COLUMN IF NOT EXISTS risk_rating text DEFAULT 'medium';
