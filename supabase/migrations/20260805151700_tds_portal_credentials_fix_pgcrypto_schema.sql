-- ─────────────────────────────────────────────────────────────────────────────
-- ROOT CAUSE FIX: ITD/TRACES credentials have NEVER successfully saved,
-- for any client, ever.
--
-- 20260804120000_tds_portal_credentials.sql installed pgcrypto with a bare
-- `CREATE EXTENSION IF NOT EXISTS pgcrypto` — Supabase projects install
-- pgcrypto into the `extensions` schema, not `public` (confirmed live:
-- `select extname, nspname from pg_extension join pg_namespace ...` shows
-- pgcrypto in schema `extensions`). Both tds_save_portal_credentials and
-- tds_read_portal_credentials were created with `SET search_path = public`
-- only, so pgp_sym_encrypt/pgp_sym_decrypt were never actually reachable —
-- confirmed live by calling tds_save_portal_credentials directly inside a
-- rolled-back transaction against a real row:
--   ERROR: 42883: function pgp_sym_encrypt(text, text) does not exist
--
-- Because the UPDATE in tds_save_portal_credentials sets itd_login_id AND
-- itd_password_encrypted (and the TRACES equivalents) in the SAME statement,
-- and Postgres UPDATE is atomic, this error rolled back the ENTIRE write
-- whenever a password field was non-null/non-empty — which is virtually
-- always, since the UI form has both fields together. That's why even the
-- LOGIN ID (a plain-text field with no encryption involved at all) never
-- persisted either: a direct query confirmed ZERO rows across the whole
-- database have ever had itd_login_id or traces_login_id set. Every
-- "credentials not saving" report was hitting this same 100%-reproducible
-- failure — the two earlier fixes (package-wise billing mode dropping the
-- save call entirely; TDS Compliance having no config fields at all when
-- checked into a package) were real, separate bugs in their own right, but
-- neither was the full story: even a client configured perfectly, hitting
-- every one of those fixes correctly, still could not have saved a
-- credential, because the database function itself could never complete.
--
-- Fix: add `extensions` to both functions' search_path AND fully-qualify
-- the calls as extensions.pgp_sym_encrypt/decrypt — the qualified call is
-- the standard hardening for a SECURITY DEFINER function (never trust an
-- unqualified call to resolve correctly regardless of search_path), the
-- search_path addition is belt-and-braces. Verified against a real row
-- inside a rolled-back transaction before this migration was written.
-- ─────────────────────────────────────────────────────────────────────────────

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
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.client_services SET
    itd_login_id = p_itd_login_id,
    itd_password_encrypted = CASE
      WHEN p_itd_password IS NULL THEN itd_password_encrypted
      WHEN p_itd_password = '' THEN NULL
      ELSE extensions.pgp_sym_encrypt(p_itd_password, p_key)
    END,
    traces_login_id = p_traces_login_id,
    traces_password_encrypted = CASE
      WHEN p_traces_password IS NULL THEN traces_password_encrypted
      WHEN p_traces_password = '' THEN NULL
      ELSE extensions.pgp_sym_encrypt(p_traces_password, p_key)
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
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.itd_login_id,
    CASE WHEN cs.itd_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(cs.itd_password_encrypted, p_key) END,
    cs.traces_login_id,
    CASE WHEN cs.traces_password_encrypted IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(cs.traces_password_encrypted, p_key) END,
    cs.credentials_updated_at
  FROM public.client_services cs
  WHERE cs.id = p_client_service_id;
END;
$$;

-- CREATE OR REPLACE preserves existing grants, but re-stated for certainty —
-- same idempotent convention the original migration used.
REVOKE ALL ON FUNCTION public.tds_save_portal_credentials(uuid, text, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tds_read_portal_credentials(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tds_save_portal_credentials(uuid, text, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tds_read_portal_credentials(uuid, text) TO service_role;
