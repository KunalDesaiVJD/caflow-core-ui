-- Fix: The existing DELETE policy on clients is RESTRICTIVE (requires a permissive policy to also exist)
-- Drop and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Firm users can delete clients" ON public.clients;

CREATE POLICY "Firm users can delete clients"
ON public.clients
FOR DELETE
TO authenticated
USING (
  is_superadmin() 
  OR (firm_id IN (SELECT u.firm_id FROM users u WHERE u.id = auth.uid())) 
  OR (user_id = auth.uid())
);