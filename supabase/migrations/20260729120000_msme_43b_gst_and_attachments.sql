-- MSME 43B(h) — declared GST rates + permanent retention of uploads and outputs.
--
-- TWO THINGS:
--
-- 1. GST DECLARATIONS. The disallowance is now stated on the TAXABLE VALUE: GST
--    is not claimed as a deduction by a buyer taking input credit, so s.43B(h)
--    has nothing to bite on in the tax component. Where a ledger does not print
--    the tax split, the firm declares the vendor's rate instead — constrained to
--    the statutory rates (0/5/12/18/28) in code, so it is a declaration of fact
--    and not a dial that could be turned to reach a wanted figure.
--
-- 2. PERMANENT RETENTION. Every uploaded ledger, every reviewer working paper
--    and every generated output is kept, linked to the run it belongs to, so a
--    working paper can be reproduced years later without the source files being
--    hunted down again. Re-running with the same ledgers is expressly allowed
--    and simply creates a new run — nothing is overwritten, nothing is
--    de-duplicated away.
--
-- Scoping mirrors the rest of the app: FIRM-scoped RLS via
-- public.current_user_firm_id() / public.is_superadmin().
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policies).

-- ────────────────────────────────────────────────────────────────────────────
--  1. Declared GST rates on the rule profile and on signed-off runs
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.msme_43b_rule_profiles
  ADD COLUMN IF NOT EXISTS vendor_gst_rates jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.msme_43b_goldens
  ADD COLUMN IF NOT EXISTS vendor_gst_rates jsonb NOT NULL DEFAULT '{}'::jsonb;

-- GST totals on saved runs, so the retained figures explain themselves.
ALTER TABLE public.msme_43b_runs
  ADD COLUMN IF NOT EXISTS total_gst_excluded numeric NOT NULL DEFAULT 0;

ALTER TABLE public.msme_43b_runs
  ADD COLUMN IF NOT EXISTS total_gst_unidentified numeric NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────────────────────
--  2. Attachments — the files a run was built from, and the files it produced
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.msme_43b_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- the run this file belongs to. Nullable so a file can be stored the moment
  -- it is uploaded, before the run that consumes it exists.
  run_id uuid REFERENCES public.msme_43b_runs(id) ON DELETE SET NULL,
  -- 'cy_ledger' | 'fy_ledger' | 'reviewer_working' | 'workpaper_export'
  kind text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  /** path within the msme-43b storage bucket */
  storage_path text NOT NULL,
  /** sha-256 of the contents: lets a re-run be recognised as the same inputs */
  content_hash text,
  uploaded_by uuid REFERENCES public.users(id),
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msme_43b_attachments_run
  ON public.msme_43b_attachments (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_msme_43b_attachments_client
  ON public.msme_43b_attachments (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_msme_43b_attachments_hash
  ON public.msme_43b_attachments (client_id, content_hash);

ALTER TABLE public.msme_43b_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'msme_43b_attachments' AND policyname = 'firm can view msme_43b_attachments') THEN
    CREATE POLICY "firm can view msme_43b_attachments"
      ON public.msme_43b_attachments FOR SELECT TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'msme_43b_attachments' AND policyname = 'firm can insert msme_43b_attachments') THEN
    CREATE POLICY "firm can insert msme_43b_attachments"
      ON public.msme_43b_attachments FOR INSERT TO authenticated
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;

  -- Linking a file to its run after the run is inserted.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'msme_43b_attachments' AND policyname = 'firm can update msme_43b_attachments') THEN
    CREATE POLICY "firm can update msme_43b_attachments"
      ON public.msme_43b_attachments FOR UPDATE TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin())
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;

-- Deliberately NO delete policy: retention is the point of this table. Removing
-- a client still cascades, which is the intended lifecycle.

-- ────────────────────────────────────────────────────────────────────────────
--  3. Storage bucket for the files themselves
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('msme-43b', 'msme-43b', false)
ON CONFLICT (id) DO NOTHING;

-- Objects are keyed <firm_id>/<client_id>/<run-or-upload>/<filename>, so the
-- first path segment carries the tenant and RLS can be enforced on it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'firm can read msme-43b objects') THEN
    CREATE POLICY "firm can read msme-43b objects"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'msme-43b'
        AND (public.is_superadmin() OR (storage.foldername(name))[1] = public.current_user_firm_id()::text)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'firm can write msme-43b objects') THEN
    CREATE POLICY "firm can write msme-43b objects"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'msme-43b'
        AND (public.is_superadmin() OR (storage.foldername(name))[1] = public.current_user_firm_id()::text)
      );
  END IF;
END $$;
