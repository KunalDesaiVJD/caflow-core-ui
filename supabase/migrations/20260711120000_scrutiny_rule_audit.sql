-- Rule Master — audit trail + versioning for scrutiny_rules.
--
-- Every add / modify / enable / disable / delete of a scrutiny_rules row is logged with the acting
-- user (auth.uid()) and full before/after JSON snapshots. Robust by construction: an AFTER trigger
-- captures ALL changes — from the Rule Master UI, raw SQL, or a migration — so the history can never
-- be bypassed, for any firm/client. Read access is superadmin-only (rules are a global catalogue).
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policy / CREATE OR REPLACE / DROP-then-CREATE
-- trigger). Pairs with the existing scrutiny_rules RLS (superadmin-only INSERT/UPDATE/DELETE).

CREATE TABLE IF NOT EXISTS public.scrutiny_rule_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       varchar NOT NULL,
  rule_uuid     uuid,
  action        text NOT NULL,          -- insert | update | enable | disable | delete
  changed_by    uuid,
  changed_by_name text,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  before        jsonb,
  after         jsonb
);

CREATE INDEX IF NOT EXISTS idx_scrutiny_rule_audit_rule
  ON public.scrutiny_rule_audit (rule_id, changed_at DESC);

ALTER TABLE public.scrutiny_rule_audit ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrutiny_rule_audit' AND policyname = 'superadmin_read_rule_audit') THEN
    CREATE POLICY "superadmin_read_rule_audit" ON public.scrutiny_rule_audit
      FOR SELECT TO authenticated USING (is_superadmin());
  END IF;
END $$;

-- SECURITY DEFINER so the trigger can always write the audit row regardless of the audit table's RLS;
-- auth.uid() still resolves to the calling user (it reads the request JWT claim, not the exec role).
CREATE OR REPLACE FUNCTION public.log_scrutiny_rule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_uid    uuid := auth.uid();
  v_name   text;
BEGIN
  SELECT name INTO v_name FROM public.users WHERE id = v_uid;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.scrutiny_rule_audit(rule_id, rule_uuid, action, changed_by, changed_by_name, before, after)
    VALUES (NEW.rule_id, NEW.id, 'insert', v_uid, v_name, NULL, to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      v_action := CASE WHEN NEW.is_active THEN 'enable' ELSE 'disable' END;
    ELSE
      v_action := 'update';
    END IF;
    INSERT INTO public.scrutiny_rule_audit(rule_id, rule_uuid, action, changed_by, changed_by_name, before, after)
    VALUES (NEW.rule_id, NEW.id, v_action, v_uid, v_name, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.scrutiny_rule_audit(rule_id, rule_uuid, action, changed_by, changed_by_name, before, after)
    VALUES (OLD.rule_id, OLD.id, 'delete', v_uid, v_name, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_log_scrutiny_rule_change ON public.scrutiny_rules;
CREATE TRIGGER trg_log_scrutiny_rule_change
  AFTER INSERT OR UPDATE OR DELETE ON public.scrutiny_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_scrutiny_rule_change();
