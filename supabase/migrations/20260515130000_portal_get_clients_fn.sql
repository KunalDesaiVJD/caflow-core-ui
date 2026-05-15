CREATE OR REPLACE FUNCTION public.get_portal_clients_by_email()
RETURNS TABLE (
  id          uuid,
  name        text,
  firm_id     uuid,
  mobile      text,
  email       text,
  gstin       text[],
  pan         text,
  entity_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.name, c.firm_id, c.mobile, c.email,
    c.gstin::text[], c.pan, c.entity_type
  FROM public.clients c
  WHERE
    c.email IS NOT NULL
    AND lower(c.email) = lower(
      (SELECT au.email FROM auth.users au WHERE au.id = auth.uid())
    )
    AND c.is_active IS NOT FALSE
    AND c.deleted_at IS NULL
  ORDER BY c.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_clients_by_email() TO authenticated;
