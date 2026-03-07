ALTER TABLE public.notification_log
ADD COLUMN IF NOT EXISTS provider_id text;