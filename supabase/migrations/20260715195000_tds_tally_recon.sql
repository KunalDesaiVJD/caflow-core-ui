/* ─────────────────────────────────────────────────────────────────────────────
   Stage-3 · Tally Ledger Reconciliation & Audit.

   Office Data (tds_deductees) is the master; a section-wise Tally ledger is
   imported and every office record is reconciled against the ledger's credit
   entries (Date · Party · Credit amount · Section). Party-name differences are
   resolved by a per-CLIENT saved mapping (e.g. office "ABC ENTERPRISE" ↔ ledger
   "RAJESH KUMAR", the proprietor) that the user confirms once and is reused.

   Tables:
     1. tds_tally_batches      — one per uploaded Tally ledger file
     2. tds_tally_rows         — parsed ledger rows
     3. tds_tally_results      — per office-record reconciliation outcome + override
     4. tds_tally_party_maps   — saved office↔ledger party mappings, per client

   RLS + patterns mirror 20260713130000_tds_pan_verification.sql. Idempotent;
   block comments only (applied by collapsing to one line).
   ───────────────────────────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.tds_tally_batches (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id      uuid        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  client_id      uuid        NOT NULL REFERENCES public.clients(id)     ON DELETE CASCADE,
  firm_id        uuid        NOT NULL,
  financial_year text        NOT NULL,
  quarter        text        NOT NULL,
  form_type      text        NOT NULL,
  file_name      text,
  section        text,
  row_count      integer     DEFAULT 0,
  status         text        NOT NULL DEFAULT 'imported',
  imported_by    uuid,
  imported_at    timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_tally_batches_filing ON public.tds_tally_batches (filing_id, imported_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS tds_tally_batches_uniq_file ON public.tds_tally_batches (filing_id, file_name) WHERE file_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tds_tally_rows (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid        NOT NULL REFERENCES public.tds_tally_batches(id) ON DELETE CASCADE,
  filing_id   uuid        NOT NULL REFERENCES public.tds_filings(id)       ON DELETE CASCADE,
  firm_id     uuid        NOT NULL,
  row_index   integer,
  date_text   text,
  date_iso    text,
  party       text,
  debit       numeric,
  credit      numeric,
  vch_no      text,
  vch_type    text,
  raw         jsonb,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_tally_rows_batch ON public.tds_tally_rows (batch_id);

CREATE TABLE IF NOT EXISTS public.tds_tally_results (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id          uuid        NOT NULL REFERENCES public.tds_filings(id)      ON DELETE CASCADE,
  batch_id           uuid        REFERENCES public.tds_tally_batches(id)         ON DELETE SET NULL,
  firm_id            uuid        NOT NULL,
  office_deductee_id uuid        REFERENCES public.tds_deductees(id)             ON DELETE SET NULL,
  quarter            text,
  office_name        text,
  office_date        text,
  office_amount      numeric,
  office_tds         numeric,
  office_section     text,
  tally_row_index    integer,
  tally_party        text,
  tally_date         text,
  tally_credit       numeric,
  result             text        NOT NULL,
  amount_basis       text,
  reason             text,
  confidence         integer,
  mapped             boolean     NOT NULL DEFAULT false,
  overridden         boolean     NOT NULL DEFAULT false,
  override_reason    text,
  overridden_by      uuid,
  overridden_at      timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_tally_results_filing ON public.tds_tally_results (filing_id);

CREATE TABLE IF NOT EXISTS public.tds_tally_party_maps (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          uuid        NOT NULL,
  client_id        uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  office_name_norm text        NOT NULL,
  office_name      text,
  tally_party      text        NOT NULL,
  created_by       uuid,
  created_at       timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tds_tally_party_maps_uniq ON public.tds_tally_party_maps (client_id, office_name_norm);

ALTER TABLE public.tds_tally_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_tally_rows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_tally_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_tally_party_maps  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tds_tally_batches','tds_tally_rows','tds_tally_results','tds_tally_party_maps'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all_%1$s ON public.%1$s;', t);
    EXECUTE format('CREATE POLICY service_role_all_%1$s ON public.%1$s FOR ALL TO service_role USING (true) WITH CHECK (true);', t);
    EXECUTE format('DROP POLICY IF EXISTS auth_firm_%1$s ON public.%1$s;', t);
    EXECUTE format('CREATE POLICY auth_firm_%1$s ON public.%1$s FOR ALL TO authenticated USING (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())) WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));', t);
  END LOOP;
END$$;

DROP TRIGGER IF EXISTS tds_tally_batches_updated_at ON public.tds_tally_batches;
CREATE TRIGGER tds_tally_batches_updated_at BEFORE UPDATE ON public.tds_tally_batches FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();
DROP TRIGGER IF EXISTS tds_tally_results_updated_at ON public.tds_tally_results;
CREATE TRIGGER tds_tally_results_updated_at BEFORE UPDATE ON public.tds_tally_results FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

ALTER TABLE public.tds_tally_results REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tds_tally_results; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END$$;
