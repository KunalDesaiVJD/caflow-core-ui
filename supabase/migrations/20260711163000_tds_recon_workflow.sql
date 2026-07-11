-- ─────────────────────────────────────────────────────────────────────────────
-- Validate & Finalise → Office ↔ Imported Client Data reconciliation workflow.
--
-- Office Data  = manually-entered tds_deductees (+ tds_challans) for a filing.
-- Client Data  = the file (Excel/CSV/PDF) the client sends, parsed into rows.
-- The two are compared; every mismatch must be matched or overridden before the
-- return can be marked Ready to File.
--
-- Tables:
--   1. tds_import_batches — one row per client-file import into a filing
--   2. tds_imported_rows  — the parsed client rows (Dataset 2)
--   3. tds_recon_results  — per-record comparison outcome + override state
--
-- RLS mirrors 20260428100000_tds_recon_tables.sql: firm-scoped via
-- public.users.firm_id for authenticated users, full bypass for service_role
-- (the edge functions write with the service-role key). Idempotent throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tds_import_batches ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_import_batches (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id      uuid        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  client_id      uuid        NOT NULL REFERENCES public.clients(id)     ON DELETE CASCADE,
  firm_id        uuid        NOT NULL,
  financial_year text        NOT NULL,
  quarter        text        NOT NULL,
  form_type      text        NOT NULL,
  file_name      text,
  file_type      text,                        -- xlsx | csv | pdf
  row_count      integer     DEFAULT 0,
  status         text        NOT NULL DEFAULT 'imported',
  imported_by    uuid,
  imported_at    timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tds_import_batches_filing
  ON public.tds_import_batches (filing_id, imported_at DESC);

-- ── 2. tds_imported_rows ─────────────────────────────────────────────────────
-- Dates are stored as text: client files arrive in many formats (dd/mm/yyyy,
-- dd-Mon-yy, …) and the comparison step normalises them. Amounts are numeric.
CREATE TABLE IF NOT EXISTS public.tds_imported_rows (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid        NOT NULL REFERENCES public.tds_import_batches(id) ON DELETE CASCADE,
  filing_id         uuid        NOT NULL REFERENCES public.tds_filings(id)        ON DELETE CASCADE,
  firm_id           uuid        NOT NULL,
  row_index         integer,
  deductee_name     text,
  pan               text,
  section_code      text,
  amount_paid       numeric,
  tds_amount        numeric,
  rate              numeric,
  date_of_payment   text,
  date_of_deduction text,
  challan_bsr       text,
  challan_no        text,
  raw               jsonb,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tds_imported_rows_batch  ON public.tds_imported_rows (batch_id);
CREATE INDEX IF NOT EXISTS tds_imported_rows_filing ON public.tds_imported_rows (filing_id);

-- ── 3. tds_recon_results ─────────────────────────────────────────────────────
-- match_status ∈ matched | mismatched | office_only | imported_only
-- field_diffs  = [{ field, office, imported, difference, matched }]
CREATE TABLE IF NOT EXISTS public.tds_recon_results (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id          uuid        NOT NULL REFERENCES public.tds_filings(id)        ON DELETE CASCADE,
  batch_id           uuid        NOT NULL REFERENCES public.tds_import_batches(id) ON DELETE CASCADE,
  firm_id            uuid        NOT NULL,
  office_deductee_id uuid        REFERENCES public.tds_deductees(id)      ON DELETE SET NULL,
  imported_row_id    uuid        REFERENCES public.tds_imported_rows(id)  ON DELETE SET NULL,
  record_label       text,
  match_status       text        NOT NULL DEFAULT 'mismatched',
  mismatch_fields    text[]      DEFAULT '{}',
  field_diffs        jsonb       DEFAULT '[]',
  overridden         boolean     NOT NULL DEFAULT false,
  overridden_by      uuid,
  overridden_at      timestamptz,
  override_note      text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tds_recon_results_filing ON public.tds_recon_results (filing_id);
CREATE INDEX IF NOT EXISTS tds_recon_results_batch  ON public.tds_recon_results (batch_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.tds_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_imported_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_recon_results  ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (edge functions write with the service-role key)
DROP POLICY IF EXISTS "service_role_all_import_batches" ON public.tds_import_batches;
CREATE POLICY "service_role_all_import_batches"
  ON public.tds_import_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_imported_rows" ON public.tds_imported_rows;
CREATE POLICY "service_role_all_imported_rows"
  ON public.tds_imported_rows FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_recon_results" ON public.tds_recon_results;
CREATE POLICY "service_role_all_recon_results"
  ON public.tds_recon_results FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users: firm-scoped via public.users.firm_id
DROP POLICY IF EXISTS "auth_firm_import_batches" ON public.tds_import_batches;
CREATE POLICY "auth_firm_import_batches"
  ON public.tds_import_batches FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "auth_firm_imported_rows" ON public.tds_imported_rows;
CREATE POLICY "auth_firm_imported_rows"
  ON public.tds_imported_rows FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "auth_firm_recon_results" ON public.tds_recon_results;
CREATE POLICY "auth_firm_recon_results"
  ON public.tds_recon_results FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

-- ── updated_at triggers (reuse existing public.tds_set_updated_at) ───────────
DROP TRIGGER IF EXISTS tds_import_batches_updated_at ON public.tds_import_batches;
CREATE TRIGGER tds_import_batches_updated_at
  BEFORE UPDATE ON public.tds_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

DROP TRIGGER IF EXISTS tds_recon_results_updated_at ON public.tds_recon_results;
CREATE TRIGGER tds_recon_results_updated_at
  BEFORE UPDATE ON public.tds_recon_results
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

-- Realtime: let the UI reflect override/compare changes live (best-effort).
ALTER TABLE public.tds_recon_results REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tds_recon_results;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END$$;
