-- 1. Add superadmin bypass policies for client_fy_classifications
CREATE POLICY "superadmin_select_fy_classifications"
ON public.client_fy_classifications FOR SELECT
TO authenticated
USING (public.is_superadmin());

CREATE POLICY "superadmin_insert_fy_classifications"
ON public.client_fy_classifications FOR INSERT
TO authenticated
WITH CHECK (public.is_superadmin());

CREATE POLICY "superadmin_update_fy_classifications"
ON public.client_fy_classifications FOR UPDATE
TO authenticated
USING (public.is_superadmin())
WITH CHECK (public.is_superadmin());

CREATE POLICY "superadmin_delete_fy_classifications"
ON public.client_fy_classifications FOR DELETE
TO authenticated
USING (public.is_superadmin());

-- 2. Transfer Demo CA Firm clients to V J Desai & Co.
UPDATE public.clients
SET firm_id = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b'
WHERE firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1';
