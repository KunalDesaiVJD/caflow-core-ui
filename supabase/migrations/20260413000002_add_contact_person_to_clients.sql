-- ISSUE-13: Add contact_person column to clients table
-- Stores the name of the authorised signatory or primary contact for the client.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_person TEXT;

COMMENT ON COLUMN public.clients.contact_person IS
  'Name of the authorised signatory or primary contact person (e.g. Managing Director, Partner)';
