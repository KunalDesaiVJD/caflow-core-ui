-- Persistence for the MSME 43B(h) Analyser: saved disallowance runs per client.
--
-- Each row is one analysis run (a CY→FY pair of vendor ledgers processed by the
-- utility at /msme-43b). The full computed report — vendor and bill-level detail
-- with the audit trail — is stored as JSONB so a run can be reloaded and drilled
-- into later without re-uploading the source PDFs.
--
-- Scoping mirrors the rest of the app: FIRM-scoped RLS via
-- public.current_user_firm_id() / public.is_superadmin(). client_id ties the run
-- to a client; deleting the client cascades.
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policies).

CREATE TABLE IF NOT EXISTS public.msme_43b_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  cy_label text NOT NULL,
  fy_label text,
  window_days integer NOT NULL DEFAULT 45,
  total_disallowed_cy numeric NOT NULL DEFAULT 0,
  total_allowed_fy numeric NOT NULL DEFAULT 0,
  total_still_outstanding numeric NOT NULL DEFAULT 0,
  vendor_count integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL,
  note text,
  created_by uuid REFERENCES public.users(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msme_43b_runs_client
  ON public.msme_43b_runs (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_msme_43b_runs_firm
  ON public.msme_43b_runs (firm_id, created_at DESC);

ALTER TABLE public.msme_43b_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'msme_43b_runs' AND policyname = 'Users can view their firm MSME 43B runs'
  ) THEN
    CREATE POLICY "Users can view their firm MSME 43B runs"
      ON public.msme_43b_runs FOR SELECT
      TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'msme_43b_runs' AND policyname = 'Users can insert MSME 43B runs for their firm'
  ) THEN
    CREATE POLICY "Users can insert MSME 43B runs for their firm"
      ON public.msme_43b_runs FOR INSERT
      TO authenticated
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'msme_43b_runs' AND policyname = 'Users can delete their firm MSME 43B runs'
  ) THEN
    CREATE POLICY "Users can delete their firm MSME 43B runs"
      ON public.msme_43b_runs FOR DELETE
      TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;
