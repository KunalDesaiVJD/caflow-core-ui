
ALTER TABLE public.client_services
  ADD COLUMN IF NOT EXISTS tds_forms_applicable text[],
  ADD COLUMN IF NOT EXISTS tds_effective_from_fy text,
  ADD COLUMN IF NOT EXISTS tds_effective_from_q text,
  ADD COLUMN IF NOT EXISTS tds_deactivated_from_fy text,
  ADD COLUMN IF NOT EXISTS tds_deactivated_from_q text;
