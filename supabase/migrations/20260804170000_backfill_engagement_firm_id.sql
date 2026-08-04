-- ─────────────────────────────────────────────────────────────────────────
-- Backfill + guard: audit_engagements.firm_id must match the client's firm.
--
-- Problem
--   The Stage 7 "PY Shell — FY xxxx" navigation banner and its
--   "Open PY Shell Tally Sync" button only render when the viewer can SELECT
--   the FY-1 is_py_shell engagement. RLS on audit_engagements is:
--       USING ( is_superadmin() OR firm_id = current_user_firm_id() )
--   A PY shell created with a NULL (or a different) firm_id is therefore
--   invisible to every non-superadmin firm member — only the superadmin, who
--   bypasses RLS via is_superadmin(), sees the banner. Regular users (e.g.
--   staff auditors) saw "nothing above" because the shell row was filtered
--   out for them.
--
--   A PY shell is a pure client-derived record, so its firm_id must always
--   equal the client's firm_id. Some shells were created by the frontend
--   ("Setup PY Data") or by sync scripts before this was enforced, leaving a
--   NULL or stale firm_id.
--
-- Fix (idempotent)
--   1. Align every is_py_shell engagement's firm_id to its client's firm_id
--      (repairs both NULL and mismatched values).
--   2. Fill NULL firm_id on regular (non-shell) engagements from their client
--      — do NOT overwrite an existing non-null firm_id on real engagements.
--   3. Add a BEFORE INSERT/UPDATE trigger so future rows inherit the client's
--      firm automatically, closing every insertion path (frontend, scripts,
--      edge functions), not just the one in the UI.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Realign existing PY shells to their client's firm (NULL or mismatched).
UPDATE public.audit_engagements e
SET    firm_id = c.firm_id
FROM   public.clients c
WHERE  e.client_id = c.id
  AND  e.is_py_shell = true
  AND  c.firm_id IS NOT NULL
  AND  e.firm_id IS DISTINCT FROM c.firm_id;

-- 2. Fill NULL firm_id on regular engagements from their client.
UPDATE public.audit_engagements e
SET    firm_id = c.firm_id
FROM   public.clients c
WHERE  e.client_id = c.id
  AND  COALESCE(e.is_py_shell, false) = false
  AND  e.firm_id IS NULL
  AND  c.firm_id IS NOT NULL;

-- 3. Guard trigger — keep firm_id consistent with the client on write.
CREATE OR REPLACE FUNCTION public.audit_engagements_set_firm_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_firm uuid;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT firm_id INTO v_client_firm
    FROM public.clients
    WHERE id = NEW.client_id;

    IF COALESCE(NEW.is_py_shell, false) THEN
      -- PY shells always inherit the client's firm so every firm member can
      -- see them under RLS (never leave a shell on a stale/NULL firm).
      IF v_client_firm IS NOT NULL AND NEW.firm_id IS DISTINCT FROM v_client_firm THEN
        NEW.firm_id := v_client_firm;
      END IF;
    ELSIF NEW.firm_id IS NULL THEN
      -- Regular engagements: only fill a missing firm; never override one the
      -- caller deliberately set.
      NEW.firm_id := v_client_firm;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_engagements_set_firm_id ON public.audit_engagements;
CREATE TRIGGER trg_audit_engagements_set_firm_id
BEFORE INSERT OR UPDATE ON public.audit_engagements
FOR EACH ROW
EXECUTE FUNCTION public.audit_engagements_set_firm_id();
