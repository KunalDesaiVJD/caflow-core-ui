-- Fix existing audit firm to point to correct firm
UPDATE public.audit_firms
SET firm_id = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b'
WHERE id = 'a5f624b5-a14c-42c6-aa2c-7cd93edcf8c1';

-- Add audit firm entries for the other 3 firms
INSERT INTO public.audit_firms (firm_id, name, active)
VALUES
  ('6f12d581-5a95-4a31-b2ff-60c0df325598', 'Dixita Desai', true),
  ('5255a3a2-4b94-45cf-8aff-f5016d98531c', 'K Desai & Associates', true),
  ('046a5de4-11a9-425a-aaa9-4cfdd78ac6d1', 'Demo CA Firm', true)
ON CONFLICT DO NOTHING;