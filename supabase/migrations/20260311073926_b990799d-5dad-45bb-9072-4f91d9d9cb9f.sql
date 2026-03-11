
-- Add pipeline columns to audit_engagements
ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS audit_period_type text DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS period_label text,
  ADD COLUMN IF NOT EXISTS parent_engagement_id uuid REFERENCES public.audit_engagements(id),
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS requires_caro boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_3ca boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_3cb boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_3cd boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_cash_flow boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cash_flow_method text DEFAULT 'indirect',
  ADD COLUMN IF NOT EXISTS schedule_iii_division text,
  ADD COLUMN IF NOT EXISTS pipeline_stage integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stage_statuses jsonb DEFAULT '{"1":"not_started","2":"not_started","3":"not_started","4":"not_started","5":"not_started","6":"not_started","7":"not_started","8":"not_started","9":"not_started","10":"not_started"}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_locked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS udin text,
  ADD COLUMN IF NOT EXISTS sign_off_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS sign_off_date date,
  ADD COLUMN IF NOT EXISTS fs_preparation_mode text DEFAULT 'tb_mapped',
  ADD COLUMN IF NOT EXISTS questionnaire_answers jsonb DEFAULT '{}'::jsonb;
