-- 20260605000001_fs_reconciliation_log.sql
--
-- Historical log of FS reconciliation drift — captures every time the Stage 7
-- FsHealthPanel detected a severe disagreement between a note's computed total
-- and the BS / P&L face value. Powers an admin-side "FS Drift History" view
-- so a regression can be traced back to the specific engagement + auditor +
-- timestamp that caused it.
--
-- Drift detected via src/lib/fsReconciliation.ts validateFSReconciliation.
-- Persisted via logReconciliationDrift in the same module, called from
-- PipelineFinancialStatements after every save when severe drift is found.

CREATE TABLE IF NOT EXISTS public.fs_reconciliation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,                  -- FS code, e.g. NCE_TP
  note_type       TEXT NOT NULL,                  -- e.g. trade_payables
  col             TEXT,                           -- Pattern A column: lt / st / null
  note_total_cy   NUMERIC(20, 2),
  note_total_py   NUMERIC(20, 2),
  bs_face_cy      NUMERIC(20, 2),
  bs_face_py      NUMERIC(20, 2),
  delta_cy        NUMERIC(20, 2),
  delta_py        NUMERIC(20, 2),
  changed_by      UUID,                            -- auth.users.id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fs_reconciliation_log_eng_idx
  ON public.fs_reconciliation_log (engagement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fs_reconciliation_log_code_idx
  ON public.fs_reconciliation_log (code, created_at DESC);

-- RLS: same firm-scoped read as engagement_audit_log.
ALTER TABLE public.fs_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fs_reconciliation_log_read" ON public.fs_reconciliation_log;
CREATE POLICY "fs_reconciliation_log_read"
  ON public.fs_reconciliation_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audit_engagements e
      WHERE e.id = engagement_id
        AND (
          e.firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'superadmin')
        )
    )
  );

DROP POLICY IF EXISTS "fs_reconciliation_log_insert" ON public.fs_reconciliation_log;
CREATE POLICY "fs_reconciliation_log_insert"
  ON public.fs_reconciliation_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audit_engagements e
      WHERE e.id = engagement_id
        AND (
          e.firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'superadmin')
        )
    )
  );

COMMENT ON TABLE public.fs_reconciliation_log IS
  'FS Health drift history — appended when note total disagrees with BS face by > ₹100. '
  'Created 2026-06-05 as the structural guarantee that NCE FS notes never silently diverge.';
