-- Claude API key, set from Settings → AI by a superadmin / firm_admin.
--
-- The key itself lives only in Supabase Vault (encrypted at rest). This table
-- keeps the Vault secret's id plus display metadata (last 4 characters, who
-- saved it and when). RLS is on with NO policies, so anon and authenticated
-- users cannot read or write it at all; only the service role (the Vercel
-- /api/claude function) reaches it, through the functions below.
--
-- Every function re-checks that the acting user is superadmin or firm_admin,
-- so the server route is not the only gate. Execute is granted to
-- service_role only; the browser never calls these directly.

CREATE TABLE IF NOT EXISTS public.ai_settings (
  provider        text PRIMARY KEY CHECK (provider IN ('anthropic')),
  vault_secret_id uuid NOT NULL,
  key_last4       text NOT NULL,
  saved_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  saved_by_name   text,
  saved_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_settings FROM anon, authenticated;

-- Admin check shared by the write functions. p_actor is the user id the
-- server route verified from the caller's JWT.
CREATE OR REPLACE FUNCTION public.ai_settings_assert_admin(p_actor uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_name text;
BEGIN
  SELECT role, coalesce(nullif(name, ''), email) INTO v_role, v_name
    FROM public.users
   WHERE id = p_actor AND coalesce(is_active, true);
  IF v_role IS NULL OR v_role NOT IN ('superadmin', 'firm_admin') THEN
    RAISE EXCEPTION 'Only an admin can change the AI key' USING ERRCODE = '42501';
  END IF;
  RETURN v_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_settings_set_anthropic_key(p_actor uuid, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   text := public.ai_settings_assert_admin(p_actor);
  v_key    text := btrim(coalesce(p_key, ''));
  v_secret uuid;
  v_saved  timestamptz := now();
BEGIN
  -- Error messages never include the key.
  IF v_key !~ '^sk-ant-[A-Za-z0-9_-]{20,250}$' THEN
    RAISE EXCEPTION 'That does not look like an Anthropic API key (it should start with sk-ant-)'
      USING ERRCODE = '22023';
  END IF;

  SELECT vault_secret_id INTO v_secret FROM public.ai_settings WHERE provider = 'anthropic';

  IF v_secret IS NOT NULL AND EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_secret) THEN
    PERFORM vault.update_secret(v_secret, v_key);
  ELSE
    v_secret := vault.create_secret(
      v_key,
      'caflow_anthropic_api_key_' || replace(gen_random_uuid()::text, '-', ''),
      'Anthropic API key saved from CAFlow Settings → AI'
    );
  END IF;

  INSERT INTO public.ai_settings (provider, vault_secret_id, key_last4, saved_by, saved_by_name, saved_at)
  VALUES ('anthropic', v_secret, right(v_key, 4), p_actor, v_name, v_saved)
  ON CONFLICT (provider) DO UPDATE
    SET vault_secret_id = EXCLUDED.vault_secret_id,
        key_last4       = EXCLUDED.key_last4,
        saved_by        = EXCLUDED.saved_by,
        saved_by_name   = EXCLUDED.saved_by_name,
        saved_at        = EXCLUDED.saved_at;

  RETURN jsonb_build_object('key_last4', right(v_key, 4), 'saved_by_name', v_name, 'saved_at', v_saved);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_settings_remove_anthropic_key(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret uuid;
BEGIN
  PERFORM public.ai_settings_assert_admin(p_actor);
  DELETE FROM public.ai_settings WHERE provider = 'anthropic' RETURNING vault_secret_id INTO v_secret;
  IF v_secret IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret;
  END IF;
END;
$$;

-- Decrypts the saved key for the server. service_role only.
CREATE OR REPLACE FUNCTION public.ai_settings_get_anthropic_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.decrypted_secret
    FROM public.ai_settings s
    JOIN vault.decrypted_secrets d ON d.id = s.vault_secret_id
   WHERE s.provider = 'anthropic'
$$;

REVOKE ALL ON FUNCTION public.ai_settings_assert_admin(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_settings_set_anthropic_key(uuid, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_settings_remove_anthropic_key(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_settings_get_anthropic_key()             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_settings_set_anthropic_key(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_settings_remove_anthropic_key(uuid)    TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_settings_get_anthropic_key()           TO service_role;
GRANT SELECT ON public.ai_settings TO service_role;
