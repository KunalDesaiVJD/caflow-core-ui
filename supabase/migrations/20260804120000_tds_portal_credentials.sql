-- ITD (Income Tax e-filing portal) and TRACES login credentials, stored per
-- TDS-Compliance client_services row — the same row the "TDS Compliance"
-- panel (StepServiceBilling.tsx) already writes Frequency/Billing/etc. to.
--
-- Passwords are ENCRYPTED AT REST via pgcrypto (pgp_sym_encrypt/decrypt).
-- The encryption key lives ONLY in the tds-portal-credentials edge
-- function's own secret (TDS_CREDENTIALS_ENCRYPTION_KEY) — never in this
-- database, never sent to or stored by the browser.
--
-- tds_save_portal_credentials / tds_read_portal_credentials are the ONLY
-- way to write or read the encrypted columns. Both are SECURITY DEFINER so
-- they can update/select the table regardless of the calling role's own
-- grants, but EXECUTE is revoked from PUBLIC (and therefore from `anon` and
-- `authenticated`) and granted ONLY to `service_role` — so a browser session
-- can never call these directly, even with a valid user JWT; only the edge
-- function (which independently verifies the caller belongs to the target
-- client's firm before ever calling either function — see its own source)
-- can reach them. Login IDs are plain text (not secret in the same way a
-- password is — often the TAN itself), so they're readable via the normal
-- client_services RLS-protected SELECT the rest of this table already uses.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.client_services
  ADD COLUMN IF NOT EXISTS itd_login_id text,
  ADD COLUMN IF NOT EXISTS itd_password_encrypted bytea,
  ADD COLUMN IF NOT EXISTS traces_login_id text,
  ADD COLUMN IF NOT EXISTS traces_password_encrypted bytea,
  ADD COLUMN IF NOT EXISTS credentials_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS credentials_updated_by uuid REFERENCES public.users(id);

CREATE OR REPLACE FUNCTION public.tds_save_portal_credentials(
  p_client_service_id uuid,
  p_itd_login_id text,
  p_itd_password text,      -- NULL = leave the stored password unchanged
  p_traces_login_id text,
  p_traces_password text,   -- NULL = leave the stored password unchanged
  p_key text,
  p_updated_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.client_services SET
    itd_login_id = p_itd_login_id,
    itd_password_encrypted = CASE
      WHEN p_itd_password IS NULL THEN itd_password_encrypted
      WHEN p_itd_password = '' THEN NULL
      ELSE pgp_sym_encrypt(p_itd_password, p_key)
    END,
    traces_login_id = p_traces_login_id,
    traces_password_encrypted = CASE
      WHEN p_traces_password IS NULL THEN traces_password_encrypted
      WHEN p_traces_password = '' THEN NULL
      ELSE pgp_sym_encrypt(p_traces_password, p_key)
    END,
    credentials_updated_at = now(),
    credentials_updated_by = p_updated_by
  WHERE id = p_client_service_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tds_read_portal_credentials(
  p_client_service_id uuid,
  p_key text
) RETURNS TABLE (
  itd_login_id text, itd_password text,
  traces_login_id text, traces_password text,
  credentials_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.itd_login_id,
    CASE WHEN cs.itd_password_encrypted IS NULL THEN NULL ELSE pgp_sym_decrypt(cs.itd_password_encrypted, p_key) END,
    cs.traces_login_id,
    CASE WHEN cs.traces_password_encrypted IS NULL THEN NULL ELSE pgp_sym_decrypt(cs.traces_password_encrypted, p_key) END,
    cs.credentials_updated_at
  FROM public.client_services cs
  WHERE cs.id = p_client_service_id;
END;
$$;

REVOKE ALL ON FUNCTION public.tds_save_portal_credentials(uuid, text, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tds_read_portal_credentials(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tds_save_portal_credentials(uuid, text, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tds_read_portal_credentials(uuid, text) TO service_role;
