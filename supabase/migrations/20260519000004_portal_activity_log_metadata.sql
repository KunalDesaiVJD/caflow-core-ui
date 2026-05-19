-- Rich metadata for portal activity digest emails.
-- Stores query text, reply text, attachment names, document categories.
-- Apply manually via Supabase SQL Editor.

ALTER TABLE public.portal_activity_log
  ADD COLUMN IF NOT EXISTS metadata JSONB;
