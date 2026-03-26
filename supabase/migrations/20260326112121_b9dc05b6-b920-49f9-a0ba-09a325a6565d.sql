ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS date_of_incorporation date;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS registered_state text;