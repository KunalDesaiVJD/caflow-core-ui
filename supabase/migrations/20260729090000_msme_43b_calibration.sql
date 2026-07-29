-- MSME 43B(h) Analyser — rule calibration.
--
-- Three tables that let the tool learn a firm's interpretation from a reviewer's
-- own working paper, without any ability to memorise an answer:
--
--   msme_43b_rule_profiles  the interpretation in force for a client. Holds ONLY
--                           enumerated legal positions (see src/lib/msme43b/rules.ts,
--                           validated before every write and before every apply)
--                           plus declared per-vendor s.15 windows (15 or 45 only).
--                           There is deliberately no column in which a rupee
--                           adjustment could be stored.
--
--   msme_43b_rule_changes   append-only audit trail: who changed which rule, from
--                           what to what, why, and what it did to agreement.
--
--   msme_43b_goldens        runs the firm has signed off, WITH the ledgers that
--                           produced them, so every future rule proposal can be
--                           replayed against them. A rule that would change a
--                           blessed answer is discarded by the calibrator.
--
-- Scoping mirrors the rest of the app: FIRM-scoped RLS via
-- public.current_user_firm_id() / public.is_superadmin().
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policies).

-- ────────────────────────────────────────────────────────────────────────────
--  1. Rule profile — one per client
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.msme_43b_rule_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- enumerated rule positions only, e.g. {"windowDays":15,"kasarTreatment":"cashTiming"}
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- declared per-vendor windows: [{key,vendorName,windowDays,basis,declaredBy,at}]
  vendor_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES public.users(id),
  updated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_msme_43b_rule_profiles_client
  ON public.msme_43b_rule_profiles (client_id);

-- ────────────────────────────────────────────────────────────────────────────
--  2. Audit trail — append only
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.msme_43b_rule_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  from_value jsonb,
  to_value jsonb,
  reason text,
  -- agreement with the reviewer's working before/after the change
  matched_before integer,
  matched_after integer,
  -- the working paper that prompted the change, for the file
  source_file text,
  changed_by uuid REFERENCES public.users(id),
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msme_43b_rule_changes_client
  ON public.msme_43b_rule_changes (client_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
--  3. Signed-off runs (goldens) — the regression guard
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.msme_43b_goldens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  label text NOT NULL,
  cy_label text NOT NULL,
  fy_label text,
  -- the ledgers as parsed, so the case can be replayed under a candidate rule
  cy_ledgers jsonb NOT NULL,
  fy_ledgers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {normalisedVendorName: disallowedCY} as signed off
  blessed jsonb NOT NULL,
  -- the config and declared windows under which it was signed off
  config jsonb NOT NULL,
  vendor_windows jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_off_by uuid REFERENCES public.users(id),
  signed_off_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msme_43b_goldens_client
  ON public.msme_43b_goldens (client_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
--  RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.msme_43b_rule_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.msme_43b_rule_changes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.msme_43b_goldens       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['msme_43b_rule_profiles', 'msme_43b_rule_changes', 'msme_43b_goldens'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'firm can view ' || t) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (firm_id = public.current_user_firm_id() OR public.is_superadmin())',
        'firm can view ' || t, t);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'firm can insert ' || t) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin())',
        'firm can insert ' || t, t);
    END IF;
  END LOOP;
END $$;

-- The profile is edited in place; goldens may be retired. The audit trail is
-- append-only by design and gets neither an UPDATE nor a DELETE policy.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'msme_43b_rule_profiles' AND policyname = 'firm can update msme_43b_rule_profiles') THEN
    CREATE POLICY "firm can update msme_43b_rule_profiles"
      ON public.msme_43b_rule_profiles FOR UPDATE TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin())
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'msme_43b_goldens' AND policyname = 'firm can delete msme_43b_goldens') THEN
    CREATE POLICY "firm can delete msme_43b_goldens"
      ON public.msme_43b_goldens FOR DELETE TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;
