-- ─────────────────────────────────────────────────────────────────────────────
-- TDS edit-access requests
--
-- Once a return reaches "Ready to File", Stage 1-3 and the imported files are
-- frozen (isLocked in TdsValidateFinalise.tsx). If a genuine change is needed
-- after that point, a staff member cannot just edit it — they raise a request
-- here, visible to the Firm Admin/Super Admin on that filing's own Stage 4 tab
-- (no separate dashboard). Approving a request has the SAME effect as the
-- existing "Revoke Signature" action (status reverts to "Reviewed", the
-- checker's signature is cleared) — approval literally calls that same code
-- path, this table only adds the request/response record around it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_edit_requests (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  filing_id        UUID        NOT NULL REFERENCES public.tds_filings(id) ON DELETE CASCADE,
  firm_id          UUID,
  requested_by     UUID,
  requested_by_name TEXT,
  reason           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_by      UUID,
  reviewed_by_name TEXT,
  reviewed_at      TIMESTAMPTZ,
  review_note      TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.tds_edit_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tds_edit_requests' AND policyname = 'tds_edit_requests_select'
  ) THEN
    CREATE POLICY "tds_edit_requests_select"
      ON public.tds_edit_requests FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tds_edit_requests' AND policyname = 'tds_edit_requests_insert'
  ) THEN
    CREATE POLICY "tds_edit_requests_insert"
      ON public.tds_edit_requests FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tds_edit_requests' AND policyname = 'tds_edit_requests_update'
  ) THEN
    CREATE POLICY "tds_edit_requests_update"
      ON public.tds_edit_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tds_edit_requests_filing_id ON public.tds_edit_requests(filing_id);
CREATE INDEX IF NOT EXISTS idx_tds_edit_requests_filing_status ON public.tds_edit_requests(filing_id, status);

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tds_edit_requests') AS tds_edit_requests_table;
