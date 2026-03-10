
ALTER TABLE public.audit_engagements 
  ADD COLUMN IF NOT EXISTS preliminary_complete boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_tabs jsonb DEFAULT '{"tb_import":true,"scrutiny":true,"engagements":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_type_logic text;

ALTER TABLE public.scrutiny_findings 
  ADD COLUMN IF NOT EXISTS linked_query_id uuid;
