
CREATE OR REPLACE FUNCTION public.set_user_context(p_user_id text, p_user_name text, p_user_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, false);
  PERFORM set_config('app.current_user_name', p_user_name, false);
  PERFORM set_config('app.current_user_role', p_user_role, false);
END;
$$;
