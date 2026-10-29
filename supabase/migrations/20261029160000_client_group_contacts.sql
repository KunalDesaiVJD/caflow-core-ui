-- Client group contact details: the master email / phone used for the group's
-- communication (statement of account by email and WhatsApp), plus additional
-- emails and numbers. The send dialogs pre-fill from these and offer them as
-- suggestions; the user can still edit before sending.
ALTER TABLE public.client_groups
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS extra_emails  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS extra_phones  text[] NOT NULL DEFAULT '{}';
