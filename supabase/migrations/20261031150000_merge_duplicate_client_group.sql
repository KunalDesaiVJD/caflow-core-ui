-- "Shreenathji & SNJ Group" existed twice: the second copy (29-Oct) was saved
-- with an HTML-escaped name ("&amp;") and the same two clients, so Billing
-- Reminders listed the group twice. Move anything pointing at the copy to the
-- original, then delete the copy. Client Groups now decodes entities and
-- refuses a duplicate name.
DO $$
DECLARE
  keep uuid := 'c4aab8d0-1d4c-4a4f-9157-c69a0b1a25e6';  -- Shreenathji & SNJ Group (23-Oct)
  dup  uuid := '27564989-5f8f-4d41-ac01-74699b76627c';  -- Shreenathji &amp; SNJ Group (29-Oct)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_groups WHERE id = dup) THEN RETURN; END IF;

  INSERT INTO public.client_group_memberships (group_id, client_id)
  SELECT keep, m.client_id FROM public.client_group_memberships m
  WHERE m.group_id = dup
    AND NOT EXISTS (SELECT 1 FROM public.client_group_memberships k WHERE k.group_id = keep AND k.client_id = m.client_id);

  UPDATE public.notification_log SET client_group_id = keep WHERE client_group_id = dup;

  -- A reminder rule on the copy only (none today) moves across; otherwise it goes with the copy.
  UPDATE public.billing_reminder_policies SET client_group_id = keep
  WHERE client_group_id = dup
    AND NOT EXISTS (SELECT 1 FROM public.billing_reminder_policies p WHERE p.client_group_id = keep);

  -- Keep the copy's contact details where the original has none.
  UPDATE public.client_groups k SET
    contact_email = COALESCE(k.contact_email, d.contact_email),
    contact_phone = COALESCE(k.contact_phone, d.contact_phone),
    extra_emails  = COALESCE(k.extra_emails,  d.extra_emails),
    extra_phones  = COALESCE(k.extra_phones,  d.extra_phones)
  FROM public.client_groups d WHERE k.id = keep AND d.id = dup;

  DELETE FROM public.client_groups WHERE id = dup;
END $$;
