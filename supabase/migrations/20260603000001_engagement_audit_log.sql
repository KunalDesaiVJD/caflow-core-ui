-- Engagement-level audit log
-- ---------------------------
-- Tracks every CREATE / UPDATE / DELETE on public.audit_engagements so the firm
-- can answer "who created this engagement?", "who deleted this?", "what was the
-- previous value?" — questions that today are unanswerable because the table
-- has no created_by / updated_by / created_at / updated_at columns at all.
--
-- The audit_worksheet_history table already captures field-level changes on the
-- worksheet master, but it has nothing for the engagement record itself (the
-- create event, status changes, partner reassignments, deletion).  This
-- migration fills that gap with one log table + one AFTER trigger.
--
-- Design notes:
--   • Trigger is SECURITY DEFINER so it bypasses RLS when inserting log rows.
--   • engagement_id is NOT a foreign key — we deliberately keep the log row
--     alive after the engagement is deleted, so the deletion event itself is
--     queryable forever.
--   • changed_by_name / changed_by_email are denormalised snapshots so the
--     log stays readable even if the user record is later deleted/renamed.
--   • firm_id is denormalised on the log row to power per-firm RLS reads.
--   • Service-role / cron / admin scripts (auth.uid() = NULL) will be logged
--     with changed_by = NULL.  That correctly attributes the action to
--     "system" rather than impersonating any user.

-- ── 1. Log table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id     uuid NOT NULL,
  firm_id           uuid,
  action            text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changed_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_by_name   text,
  changed_by_email  text,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  snapshot          jsonb
);

CREATE INDEX IF NOT EXISTS idx_eal_engagement_id ON public.engagement_audit_log(engagement_id);
CREATE INDEX IF NOT EXISTS idx_eal_changed_at    ON public.engagement_audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_eal_firm_id       ON public.engagement_audit_log(firm_id);
CREATE INDEX IF NOT EXISTS idx_eal_changed_by    ON public.engagement_audit_log(changed_by);

COMMENT ON TABLE public.engagement_audit_log IS
  'Append-only audit log of every CREATE/UPDATE/DELETE on audit_engagements. '
  'Written by the log_audit_engagement_change() trigger. '
  'engagement_id is intentionally not a FK so deleted engagements still show up.';

-- ── 2. Trigger function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_audit_engagement_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid    uuid := auth.uid();
  uname  text;
  uemail text;
BEGIN
  IF uid IS NOT NULL THEN
    SELECT name, email INTO uname, uemail FROM public.users WHERE id = uid;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.engagement_audit_log
      (engagement_id, firm_id, action, changed_by, changed_by_name, changed_by_email, snapshot)
    VALUES
      (NEW.id, NEW.firm_id, 'create', uid, uname, uemail, to_jsonb(NEW));
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO public.engagement_audit_log
      (engagement_id, firm_id, action, changed_by, changed_by_name, changed_by_email, snapshot)
    VALUES
      (NEW.id, COALESCE(NEW.firm_id, OLD.firm_id), 'update', uid, uname, uemail,
       jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.engagement_audit_log
      (engagement_id, firm_id, action, changed_by, changed_by_name, changed_by_email, snapshot)
    VALUES
      (OLD.id, OLD.firm_id, 'delete', uid, uname, uemail, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.log_audit_engagement_change() IS
  'Trigger fn — appends one row to engagement_audit_log on every '
  'INSERT/UPDATE/DELETE of audit_engagements. SECURITY DEFINER so it can '
  'write through RLS. Captures auth.uid() and snapshots the user name/email.';

-- ── 3. Wire trigger to audit_engagements ───────────────────────────────────
DROP TRIGGER IF EXISTS audit_engagement_change_trigger ON public.audit_engagements;
CREATE TRIGGER audit_engagement_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.audit_engagements
FOR EACH ROW EXECUTE FUNCTION public.log_audit_engagement_change();

-- ── 4. Row-level security ──────────────────────────────────────────────────
ALTER TABLE public.engagement_audit_log ENABLE ROW LEVEL SECURITY;

-- Read policy: any user can read logs for their own firm; superadmin sees all.
DROP POLICY IF EXISTS "engagement_audit_log_select_own_firm" ON public.engagement_audit_log;
CREATE POLICY "engagement_audit_log_select_own_firm"
  ON public.engagement_audit_log
  FOR SELECT
  USING (
    firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'superadmin')
  );

-- No INSERT / UPDATE / DELETE policies exist.  The trigger writes via
-- SECURITY DEFINER, which bypasses RLS; direct writes from the client are
-- rejected because no permissive policy matches.  This makes the log
-- effectively append-only from any application code path.

-- ── 5. Helpful comment for future maintainers ──────────────────────────────
COMMENT ON COLUMN public.engagement_audit_log.snapshot IS
  'For create/delete: to_jsonb(row). For update: {before:..., after:...}. '
  'Used to answer "what changed" without joining back to a deleted engagement.';
