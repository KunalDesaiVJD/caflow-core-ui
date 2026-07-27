-- Audit trail for TDS Rate Master (tds_rate_master) create/edit events.
--
-- tds_rate_master rows are FIRM-scoped configuration (firm_id IS NULL for a
-- global default, or a specific firm's override otherwise) — they are not
-- tied to any single tds_filings row. logReconAudit()/tds_filing_audit_log
-- is filing-scoped by design (its RLS, and the Stage-4 / TdsAuditLog.tsx
-- views that read it, all key off filing_id), so a Rate Master change has no
-- natural filing_id to attribute it to and must NOT be logged there. This is
-- a separate, purpose-built table for that reason — see
-- src/lib/tdsRateMasterAudit.ts.
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policies).

CREATE TABLE IF NOT EXISTS public.tds_rate_master_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_master_id uuid REFERENCES public.tds_rate_master(id) ON DELETE SET NULL,
  firm_id uuid REFERENCES public.firms(id),
  action_type text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES public.users(id),
  changed_by_name text,
  changed_at timestamptz DEFAULT now(),
  remark text
);

CREATE INDEX IF NOT EXISTS idx_tds_rate_master_audit_log_rate_master
  ON public.tds_rate_master_audit_log (rate_master_id, changed_at DESC);

ALTER TABLE public.tds_rate_master_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tds_rate_master_audit_log' AND policyname = 'Users can view their firm rate master audit logs'
  ) THEN
    CREATE POLICY "Users can view their firm rate master audit logs"
      ON public.tds_rate_master_audit_log FOR SELECT
      TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tds_rate_master_audit_log' AND policyname = 'Users can insert rate master audit logs for their firm'
  ) THEN
    CREATE POLICY "Users can insert rate master audit logs for their firm"
      ON public.tds_rate_master_audit_log FOR INSERT
      TO authenticated
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;
