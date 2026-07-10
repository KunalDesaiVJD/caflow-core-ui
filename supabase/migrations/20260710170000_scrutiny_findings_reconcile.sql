-- Scrutiny findings — schema reconcile (gap G2).
--
-- The scrutiny_findings table was created in the Supabase dashboard (no CREATE TABLE migration
-- exists in git), so a fresh dev/local DB built from migrations alone would NOT have it. This
-- migration (a) codifies the table so fresh DBs get it, and (b) ADDITIVELY adds the columns the
-- engine + UI need but the live table lacks (engagement-keying, audit trail, richer finding data).
--
-- SAFETY: fully additive + idempotent. CREATE TABLE IF NOT EXISTS is a no-op on the existing
-- (dashboard) table; every ALTER uses ADD COLUMN IF NOT EXISTS (new columns are nullable, so
-- existing rows and the live AuditScrutiny read/write path are unaffected).
--
-- DELIBERATELY OUT OF SCOPE: RLS hardening. scrutiny_findings has dashboard-created policies that
-- are not visible in git; tightening them safely needs DB access + knowledge of the existing
-- policies, and belongs with the security pass (Ticket 0.4). Do NOT add RLS here blind.
--
-- STATUS: authored, NOT applied (no dev DB). Apply to a DEV db only; never prod without review.

-- (a) Codify the existing table for fresh DBs. Columns + types mirror src/integrations/supabase/types.ts.
CREATE TABLE IF NOT EXISTS public.scrutiny_findings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         text,
  client_id       uuid REFERENCES public.clients(id),
  financial_year  text,
  severity        text,
  status          text DEFAULT 'open',
  flag_message    text,
  clause_3cd      text,
  narration       text,
  linked_query_id uuid
);

-- (b) Additive columns the engine + engagement-keyed UI need (PipelineStage4 was dead because it
--     wrote these and they did not exist). All nullable → backward compatible.
ALTER TABLE public.scrutiny_findings
  ADD COLUMN IF NOT EXISTS engagement_id   uuid REFERENCES public.audit_engagements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS firm_id         uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category        text,
  ADD COLUMN IF NOT EXISTS account_name    text,
  ADD COLUMN IF NOT EXISTS amount          numeric,
  ADD COLUMN IF NOT EXISTS detection_level text,
  ADD COLUMN IF NOT EXISTS advisory        boolean DEFAULT false,
  -- maker (who actioned) + checker (who reviewed) audit trail; the query-side maker-checker
  -- (decision #7) lives on audit_client_queries via linked_query_id.
  ADD COLUMN IF NOT EXISTS actioned_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actioned_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS override_reason text,
  -- stable identity for idempotent re-runs / dedup (rule_id + account + period), app-computed.
  ADD COLUMN IF NOT EXISTS finding_hash    text,
  ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now();

-- Indexes for the common read paths (existing client/FY scope + new engagement/firm scope).
CREATE INDEX IF NOT EXISTS idx_scrutiny_findings_client_fy   ON public.scrutiny_findings (client_id, financial_year);
CREATE INDEX IF NOT EXISTS idx_scrutiny_findings_engagement  ON public.scrutiny_findings (engagement_id);
CREATE INDEX IF NOT EXISTS idx_scrutiny_findings_firm        ON public.scrutiny_findings (firm_id);
CREATE INDEX IF NOT EXISTS idx_scrutiny_findings_status      ON public.scrutiny_findings (status);
CREATE INDEX IF NOT EXISTS idx_scrutiny_findings_hash        ON public.scrutiny_findings (finding_hash);

COMMENT ON TABLE public.scrutiny_findings IS
  'Scrutiny engine findings. Canonical keys: client_id + financial_year (legacy/AuditScrutiny) AND engagement_id (pipeline). severity = HIGH/MEDIUM/LOW; status = open/accepted/queried/noted/overridden (legacy AuditScrutiny also uses Open/Resolved/Waived). RLS hardening tracked separately (Ticket 0.4).';
