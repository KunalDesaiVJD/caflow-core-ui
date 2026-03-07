ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS filed_at timestamp without time zone;