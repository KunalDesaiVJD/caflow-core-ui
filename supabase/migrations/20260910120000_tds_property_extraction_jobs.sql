-- ════════════════════════════════════════════════════════════════════════════
-- Reading a registered deed that is too big to read in one request
-- ════════════════════════════════════════════════════════════════════════════
--
-- A registered Gujarati દસ્તાવેજ is a scanned image PDF — 68 to 202 pages,
-- zero embedded fonts, so no text layer at all. Every page has to be OCR'd by
-- the vision model at roughly 1,500-2,500 tokens, which puts a whole deed at
-- 120,000-350,000 tokens of images.
--
-- That cannot happen inside a request. Supabase cuts an edge-function request
-- off at a 150-second idle timeout, which is why property-agreement-extract
-- caps itself at 110s. The synchronous path is right for a 2-page Index-II and
-- hopeless for a 202-page deed: the request died, an error toast appeared for
-- a few seconds after a two-minute wait, and the form stayed empty.
--
-- So a large document becomes a JOB. The file goes to storage once, the job
-- records what has to be read, and a worker reads it in page-range chunks
-- across as many invocations as it takes. The browser polls this row for
-- progress and can be closed and reopened without losing the work.
--
-- ── Why the chunk results are stored, not just the merged answer ───────────
--
-- Each chunk's reading is kept in `chunk_results` so a worker invocation that
-- dies mid-job resumes from the last completed chunk rather than re-reading
-- pages that already cost real money. It is also the audit trail: which pages
-- a figure came from is exactly what a reviewer asks six months later.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tds_property_extraction_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           UUID NOT NULL REFERENCES firms(id)   ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Storage PATH, not a public URL: the worker downloads with the service role
  -- and the file never needs to be publicly readable to be processed.
  file_path         TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  mime_type         TEXT,

  page_count        INTEGER NOT NULL,
  chunk_size        INTEGER NOT NULL,
  chunks_total      INTEGER NOT NULL,
  chunks_done       INTEGER NOT NULL DEFAULT 0,

  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),

  -- One entry per page range read, as {fromPage, toPage, extraction}.
  chunk_results     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The merged AgreementExtraction, written once every chunk is in.
  result_json       JSONB,
  error             TEXT,

  -- A worker that dies leaves the row 'running'. The heartbeat is what lets
  -- the next caller tell a live job from an abandoned one without a lock.
  heartbeat_at      TIMESTAMPTZ,
  attempts          INTEGER NOT NULL DEFAULT 0,

  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tds_property_job_pages_positive  CHECK (page_count > 0 AND chunk_size > 0),
  CONSTRAINT tds_property_job_chunks_sane     CHECK (chunks_done >= 0 AND chunks_done <= chunks_total)
);

CREATE INDEX IF NOT EXISTS idx_tds_property_jobs_firm
  ON public.tds_property_extraction_jobs (firm_id, status, created_at DESC);

-- The worker's pickup query: oldest unfinished job first.
CREATE INDEX IF NOT EXISTS idx_tds_property_jobs_pending
  ON public.tds_property_extraction_jobs (status, heartbeat_at)
  WHERE status IN ('queued', 'running');

COMMENT ON TABLE public.tds_property_extraction_jobs IS
  'Background reading of a sale deed too large for one edge-function request. One row per uploaded document; chunk_results accumulates per page-range readings, result_json holds the merged extraction.';

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Same shape as every other tds_property_* table: a firm sees its own rows,
-- a superadmin sees all. The worker uses the service role and bypasses this.

ALTER TABLE public.tds_property_extraction_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tds_property_extraction_jobs'
      AND policyname = 'tds_property_extraction_jobs_firm_read'
  ) THEN
    CREATE POLICY tds_property_extraction_jobs_firm_read
      ON public.tds_property_extraction_jobs FOR SELECT
      USING (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tds_property_extraction_jobs'
      AND policyname = 'tds_property_extraction_jobs_firm_write'
  ) THEN
    CREATE POLICY tds_property_extraction_jobs_firm_write
      ON public.tds_property_extraction_jobs FOR ALL
      USING (is_superadmin() OR firm_id = current_user_firm_id())
      WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
  END IF;
END $$;
