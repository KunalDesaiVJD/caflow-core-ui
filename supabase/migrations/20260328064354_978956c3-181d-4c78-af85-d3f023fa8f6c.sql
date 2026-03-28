-- Move service categories to V J Desai & Co. to match clients
UPDATE public.service_categories
SET firm_id = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b'
WHERE firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1';

-- Also update the RLS SELECT policy so service categories are visible to ALL authenticated users
-- (they function as a shared catalog; write ops remain firm-scoped)
DROP POLICY IF EXISTS sc_select ON public.service_categories;
CREATE POLICY sc_select ON public.service_categories
  FOR SELECT TO authenticated
  USING (true);

-- Also move client_services that reference Demo CA Firm clients (already moved)
-- No action needed since client_services RLS checks via clients.firm_id which is now VJ Desai