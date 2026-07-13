-- ─────────────────────────────────────────────────────────────────────────────
-- Stage-2 PAN Verification for Validate & Finalise.
--
-- Compares the selected quarter's Office parties (tds_deductees) against a
-- TRACES "Bulk PAN Verification" Excel (sheet PAN_Details: PAN, Name, PAN
-- Status, …). Deterministic — PAN is an exact key, status is keyword-classified;
-- no AI. Every party gets a validation result (PAN Verified / Party Missing … /
-- PAN Status Error / PAN Inactive / PAN Invalid / PAN Status Blank) that can be
-- overridden with a mandatory reason and a full audit trail.
--
-- Tables:
--   1. tds_pan_verification_batches — one per uploaded TRACES file
--   2. tds_pan_verification_rows    — parsed TRACES PAN rows
--   3. tds_pan_verification_results — per-party outcome + override state
--
-- RLS mirrors 20260428100000_tds_recon_tables.sql (firm-scoped via
-- public.users.firm_id; service_role bypass). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. batches ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_pan_verification_batches (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id      uuid        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  client_id      uuid        NOT NULL REFERENCES public.clients(id)     ON DELETE CASCADE,
  firm_id        uuid        NOT NULL,
  financial_year text        NOT NULL,
  quarter        text        NOT NULL,
  form_type      text        NOT NULL,
  file_name      text,
  row_count      integer     DEFAULT 0,
  status         text        NOT NULL DEFAULT 'imported',
  imported_by    uuid,
  imported_at    timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_pan_ver_batches_filing
  ON public.tds_pan_verification_batches (filing_id, imported_at DESC);

-- ── 2. rows ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_pan_verification_rows (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid        NOT NULL REFERENCES public.tds_pan_verification_batches(id) ON DELETE CASCADE,
  filing_id         uuid        NOT NULL REFERENCES public.tds_filings(id)                  ON DELETE CASCADE,
  firm_id           uuid        NOT NULL,
  row_index         integer,
  pan               text,
  name              text,
  verified_name     text,
  pan_status        text,
  mismatch_in_name  text,
  raw               jsonb,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_pan_ver_rows_batch ON public.tds_pan_verification_rows (batch_id);
CREATE INDEX IF NOT EXISTS tds_pan_ver_rows_pan   ON public.tds_pan_verification_rows (batch_id, pan);

-- ── 3. results ───────────────────────────────────────────────────────────────
-- validation_result ∈ 'PAN Verified' | 'Party Missing in PAN Verification File'
--   | 'Party Missing in Office Data' | 'PAN Status Error' | 'PAN Status Blank'
--   | 'PAN Inactive' | 'PAN Invalid'
CREATE TABLE IF NOT EXISTS public.tds_pan_verification_results (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id          uuid        NOT NULL REFERENCES public.tds_filings(id)                  ON DELETE CASCADE,
  batch_id           uuid        NOT NULL REFERENCES public.tds_pan_verification_batches(id) ON DELETE CASCADE,
  firm_id            uuid        NOT NULL,
  office_deductee_id uuid        REFERENCES public.tds_deductees(id)                ON DELETE SET NULL,
  pan_row_id         uuid        REFERENCES public.tds_pan_verification_rows(id)    ON DELETE SET NULL,
  quarter            text,
  party_name         text,
  pan                text,
  pan_status         text,
  validation_result  text        NOT NULL,
  overridden         boolean     NOT NULL DEFAULT false,
  override_reason    text,
  overridden_by      uuid,
  overridden_at      timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_pan_ver_results_filing ON public.tds_pan_verification_results (filing_id);
CREATE INDEX IF NOT EXISTS tds_pan_ver_results_batch  ON public.tds_pan_verification_results (batch_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.tds_pan_verification_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_pan_verification_rows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_pan_verification_results  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_pan_batches" ON public.tds_pan_verification_batches;
CREATE POLICY "service_role_all_pan_batches" ON public.tds_pan_verification_batches FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role_all_pan_rows" ON public.tds_pan_verification_rows;
CREATE POLICY "service_role_all_pan_rows" ON public.tds_pan_verification_rows FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role_all_pan_results" ON public.tds_pan_verification_results;
CREATE POLICY "service_role_all_pan_results" ON public.tds_pan_verification_results FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_firm_pan_batches" ON public.tds_pan_verification_batches;
CREATE POLICY "auth_firm_pan_batches" ON public.tds_pan_verification_batches FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "auth_firm_pan_rows" ON public.tds_pan_verification_rows;
CREATE POLICY "auth_firm_pan_rows" ON public.tds_pan_verification_rows FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "auth_firm_pan_results" ON public.tds_pan_verification_results;
CREATE POLICY "auth_firm_pan_results" ON public.tds_pan_verification_results FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

-- ── updated_at triggers (reuse existing public.tds_set_updated_at) ───────────
DROP TRIGGER IF EXISTS tds_pan_ver_batches_updated_at ON public.tds_pan_verification_batches;
CREATE TRIGGER tds_pan_ver_batches_updated_at BEFORE UPDATE ON public.tds_pan_verification_batches
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();
DROP TRIGGER IF EXISTS tds_pan_ver_results_updated_at ON public.tds_pan_verification_results;
CREATE TRIGGER tds_pan_ver_results_updated_at BEFORE UPDATE ON public.tds_pan_verification_results
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

-- Realtime so override/validation changes reflect live (best-effort).
ALTER TABLE public.tds_pan_verification_results REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tds_pan_verification_results;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END$$;
