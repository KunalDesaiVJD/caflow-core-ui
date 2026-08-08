-- ─────────────────────────────────────────────────────────────────────────────
-- Stage-2 Challan Validation — replaces the CSI (Challan Status Inquiry) flow
-- (tds_challan_csi_batches, 20260805132600) with real per-challan matching
-- against the ITD portal's own Payment History export.
--
-- A CSI file turned out to be hash-lines only (see tds_challan_csi_batches'
-- own header doc) — no per-challan detail was ever actually checkable. The
-- ITD portal's Payment History export (e-File → e-Pay Tax → Income Tax Act,
-- 2025 → Payment History → Actions → Download) is a genuine per-challan
-- report: challan serial number, deposit date, amount. This table stores the
-- parsed portal rows AND the computed match verdict per OFFICE challan
-- (tds_challans), one JSON array each rather than a second child table —
-- cardinality varies per filing and nothing besides this UI ever needs to
-- query into individual rows.
--
-- tds_challan_csi_batches is left in place (not dropped) — no data loss,
-- can be removed later once this flow is confirmed working end to end.
--
-- Deliberately independent of corrections, same reason as the CSI table and
-- every other Validate & Finalise surface in this module: reads tds_challans
-- directly, never the correction-aware ledger.
--
-- RLS mirrors tds_challan_csi_batches (firm-scoped via public.users.firm_id;
-- service_role bypass). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_challan_download_batches (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id             uuid        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  client_id             uuid        NOT NULL REFERENCES public.clients(id)     ON DELETE CASCADE,
  firm_id               uuid        NOT NULL,
  financial_year        text        NOT NULL,
  quarter                text        NOT NULL,
  form_type             text        NOT NULL,
  file_name             text,
  file_url              text,
  -- Parsed from the downloaded Payment History PDF: [{serialNo, depositDate, amount}]
  portal_challans        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  portal_challan_count   integer,
  -- One entry per OFFICE tds_challans row (this filing, not archived):
  -- [{officeChallanId, officeSerialNo, officeDate, officeAmount, matched, reason}]
  match_results          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  matched_count          integer,
  unmatched_count         integer,
  imported_by            uuid,
  imported_at            timestamptz DEFAULT now(),
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tds_challan_download_batches_filing
  ON public.tds_challan_download_batches (filing_id, imported_at DESC);
-- Re-importing the same filename replaces it, same convention as
-- tds_challan_csi_batches_uniq_file.
CREATE UNIQUE INDEX IF NOT EXISTS tds_challan_download_batches_uniq_file
  ON public.tds_challan_download_batches (filing_id, file_name) WHERE file_name IS NOT NULL;

ALTER TABLE public.tds_challan_download_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_challan_download_batches" ON public.tds_challan_download_batches;
CREATE POLICY "service_role_all_challan_download_batches" ON public.tds_challan_download_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_firm_challan_download_batches" ON public.tds_challan_download_batches;
CREATE POLICY "auth_firm_challan_download_batches" ON public.tds_challan_download_batches FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

DROP TRIGGER IF EXISTS tds_challan_download_batches_updated_at ON public.tds_challan_download_batches;
CREATE TRIGGER tds_challan_download_batches_updated_at BEFORE UPDATE ON public.tds_challan_download_batches
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

-- Realtime so the Stage 2 badge reflects a validation run from another tab.
ALTER TABLE public.tds_challan_download_batches REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tds_challan_download_batches;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END$$;
