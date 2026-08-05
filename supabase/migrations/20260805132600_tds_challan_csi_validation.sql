-- ─────────────────────────────────────────────────────────────────────────────
-- Stage-2 Challan Validation (CSI) — a NEW sub-section alongside PAN
-- Verification, turning Stage 2 into "PAN & Challan".
--
-- A CSI (Challan Status Inquiry) file from TIN-NSDL/OLTAS is NOT a readable
-- per-challan record — verified against 12+ years of real sample files
-- (2015-2027, one per quarter): every file is a header line
--   <challan_count>^<TAN>^<Deductor Name>^<RPU ver>^<FVU ver>[^extra ver]^<total amount, paise>
-- followed by exactly <challan_count> lines, each a 32-char hash with no BSR
-- code / date / serial / amount / section anywhere in the file. The hash
-- algorithm NSDL uses is not published, so per-challan field-by-field
-- comparison against a CSI file is not something this (or any third-party
-- tool without the official RPU/FVU utility) can do.
--
-- What IS real and useful: a coarse three-way check of the CSI header
-- against this filing's own tds_challans — TAN match, challan COUNT match,
-- total AMOUNT match. This table stores one row per uploaded CSI file with
-- both sides of that comparison, computed once at import/validate time.
--
-- Deliberately independent of corrections (see feedback_validation_
-- independent_of_corrections — this is a Validate & Finalise surface, reads
-- tds_challans directly) and, for the same documented reason, cannot filter
-- a full-year CSI down to one quarter — the header has no per-challan
-- quarter tag, only a single count/amount for whatever date range the CSI
-- was generated for. Users are expected to upload a quarter-specific CSI
-- (the standard TRACES/OLTAS download granularity, matching every sample
-- file used to verify this format).
--
-- RLS mirrors 20260713130000_tds_pan_verification.sql (firm-scoped via
-- public.users.firm_id; service_role bypass). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_challan_csi_batches (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id             uuid        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  client_id             uuid        NOT NULL REFERENCES public.clients(id)     ON DELETE CASCADE,
  firm_id               uuid        NOT NULL,
  financial_year        text        NOT NULL,
  quarter                text        NOT NULL,
  form_type             text        NOT NULL,
  file_name             text,
  file_url              text,
  -- Parsed from the CSI header line.
  csi_tan                text,
  csi_deductor_name      text,
  csi_rpu_version        text,
  csi_fvu_version        text,
  csi_challan_count      integer,
  csi_total_amount       numeric(14,2),
  csi_hash_line_count    integer,  -- should equal csi_challan_count; a mismatch flags a truncated/corrupt file
  -- Office side, computed from tds_challans at validation time (independent
  -- of corrections — see the file header doc).
  office_tan             text,
  office_challan_count   integer,
  office_total_amount    numeric(14,2),
  -- Verdict, computed once and stored so the UI and the Stage 2 gate don't
  -- need a live recompute on every render.
  tan_match              boolean,
  count_match            boolean,
  amount_match            boolean,
  status                 text        NOT NULL DEFAULT 'imported',
  imported_by            uuid,
  imported_at            timestamptz DEFAULT now(),
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_challan_csi_batches_filing
  ON public.tds_challan_csi_batches (filing_id, imported_at DESC);
-- Re-importing the same filename replaces it, same convention as
-- tds_pan_ver_batches_uniq_file.
CREATE UNIQUE INDEX IF NOT EXISTS tds_challan_csi_batches_uniq_file
  ON public.tds_challan_csi_batches (filing_id, file_name) WHERE file_name IS NOT NULL;

ALTER TABLE public.tds_challan_csi_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_challan_csi_batches" ON public.tds_challan_csi_batches;
CREATE POLICY "service_role_all_challan_csi_batches" ON public.tds_challan_csi_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_firm_challan_csi_batches" ON public.tds_challan_csi_batches;
CREATE POLICY "auth_firm_challan_csi_batches" ON public.tds_challan_csi_batches FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

DROP TRIGGER IF EXISTS tds_challan_csi_batches_updated_at ON public.tds_challan_csi_batches;
CREATE TRIGGER tds_challan_csi_batches_updated_at BEFORE UPDATE ON public.tds_challan_csi_batches
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

-- Realtime so the Stage 2 badge reflects a validation run from another tab.
ALTER TABLE public.tds_challan_csi_batches REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tds_challan_csi_batches;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END$$;
