-- Settings → AI: model choice, and a key that can be removed without losing it.
--
-- The ai_settings row now holds two independent settings: the API key (in
-- Vault, as before) and the model. Removing the key clears only the key
-- columns, so the model choice stays. RLS stays on with no policies.

ALTER TABLE public.ai_settings ALTER COLUMN vault_secret_id DROP NOT NULL;
ALTER TABLE public.ai_settings ALTER COLUMN key_last4 DROP NOT NULL;
ALTER TABLE public.ai_settings ALTER COLUMN saved_at DROP NOT NULL;
ALTER TABLE public.ai_settings ALTER COLUMN saved_at DROP DEFAULT;

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS model               text,
  ADD COLUMN IF NOT EXISTS model_saved_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model_saved_by_name text,
  ADD COLUMN IF NOT EXISTS model_saved_at      timestamptz;

ALTER TABLE public.ai_settings DROP CONSTRAINT IF EXISTS ai_settings_model_shape;
ALTER TABLE public.ai_settings ADD CONSTRAINT ai_settings_model_shape
  CHECK (model IS NULL OR model ~ '^claude-[a-z0-9-]{3,60}$');

-- Key columns are set together or all empty.
ALTER TABLE public.ai_settings DROP CONSTRAINT IF EXISTS ai_settings_key_together;
ALTER TABLE public.ai_settings ADD CONSTRAINT ai_settings_key_together CHECK (
  (vault_secret_id IS NULL) = (key_last4 IS NULL)
  AND (vault_secret_id IS NULL) = (saved_at IS NULL));

-- Remove clears the key and its Vault secret, and keeps the model.
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
  SELECT vault_secret_id INTO v_secret FROM public.ai_settings WHERE provider = 'anthropic' FOR UPDATE;
  UPDATE public.ai_settings
     SET vault_secret_id = NULL, key_last4 = NULL, saved_by = NULL, saved_by_name = NULL, saved_at = NULL
   WHERE provider = 'anthropic';
  IF v_secret IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_settings_set_model(p_actor uuid, p_model text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text := public.ai_settings_assert_admin(p_actor);
  v_model text := btrim(coalesce(p_model, ''));
BEGIN
  IF v_model !~ '^claude-[a-z0-9-]{3,60}$' THEN
    RAISE EXCEPTION 'That is not a Claude model id' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ai_settings (provider, model, model_saved_by, model_saved_by_name, model_saved_at)
  VALUES ('anthropic', v_model, p_actor, v_name, now())
  ON CONFLICT (provider) DO UPDATE
    SET model = EXCLUDED.model,
        model_saved_by = EXCLUDED.model_saved_by,
        model_saved_by_name = EXCLUDED.model_saved_by_name,
        model_saved_at = EXCLUDED.model_saved_at;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_settings_remove_anthropic_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_settings_set_model(uuid, text)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_settings_remove_anthropic_key(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_settings_set_model(uuid, text)    TO service_role;
