
-- Add sign-off columns to audit_engagements
ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS signed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES public.users(id);

-- Add engagement tracking and sign-off columns to documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS engagement_id uuid REFERENCES public.audit_engagements(id),
  ADD COLUMN IF NOT EXISTS sub_category text,
  ADD COLUMN IF NOT EXISTS is_final boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_signed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS signed_at timestamp with time zone;
