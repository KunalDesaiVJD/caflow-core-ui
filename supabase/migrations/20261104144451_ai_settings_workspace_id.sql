-- Optional Anthropic workspace ID for the key saved in Settings → AI.
-- A key that is not scoped to one workspace needs it on every request
-- (sent as the anthropic-workspace-id header). Not a secret, so it is a
-- plain column; the table still has RLS on and no policies.

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS workspace_id text
  CHECK (workspace_id IS NULL OR workspace_id ~ '^wrkspc_[A-Za-z0-9_-]{6,100}$');

CREATE OR REPLACE FUNCTION public.ai_settings_set_workspace_id(p_actor uuid, p_workspace_id text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws text := nullif(btrim(coalesce(p_workspace_id, '')), '');
BEGIN
  PERFORM public.ai_settings_assert_admin(p_actor);
  IF v_ws IS NOT NULL AND v_ws !~ '^wrkspc_[A-Za-z0-9_-]{6,100}$' THEN
    RAISE EXCEPTION 'That does not look like a workspace ID (it should start with wrkspc_)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ai_settings SET workspace_id = v_ws WHERE provider = 'anthropic';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save an API key first, then the workspace ID' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_settings_set_workspace_id(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_settings_set_workspace_id(uuid, text) TO service_role;
