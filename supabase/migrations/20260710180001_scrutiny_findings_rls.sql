-- Scrutiny findings — firm-scoped RLS.
--
-- GAP: scrutiny_findings had RLS ENABLED but ZERO policies (deny-all), so the app could never read
-- the findings the engine wrote (run-scrutiny / run-scrutiny-v2 write via the service role, which
-- bypasses RLS; the UI reads with the user JWT, which was blocked). This adds the standard
-- firm-scoped policies used across the app (tally_* / sync_batches): a firm's authenticated users
-- read + update their firm's findings; superadmin sees all.
--
-- Pairs with run-scrutiny-v2 now stamping firm_id on every finding (findings are firm-scoped).
-- SAFETY: additive + idempotent (CREATE POLICY guarded by DO/EXCEPTION duplicate_object).
-- Applied to prod on 2026-07-10 to unblock the live Scrutiny Engine; codified here for fresh DBs.

ALTER TABLE public.scrutiny_findings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY scrutiny_findings_firm_select ON public.scrutiny_findings
    FOR SELECT TO authenticated
    USING (
      firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'superadmin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY scrutiny_findings_firm_update ON public.scrutiny_findings
    FOR UPDATE TO authenticated
    USING (
      firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'superadmin')
    )
    WITH CHECK (
      firm_id IN (SELECT u.firm_id FROM public.users u WHERE u.id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'superadmin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
