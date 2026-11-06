-- WFH employee screenshots — superadmin-only capture store.
--
-- Backs the Admin → Employee Screenshots section. The WFH agent on a
-- company laptop uploads screenshots (via the wfh-ingest edge function, which
-- uses the service role); the superadmin views them in-app through signed URLs.
--
-- Unlike the firm-scoped upload tables, this is gated on public.is_superadmin()
-- ALONE — these recordings are not firm data and only the platform superadmin
-- may see them.
--
-- SAFETY: additive + idempotent (IF NOT EXISTS / guarded policies).

-- ────────────────────────────────────────────────────────────────────────────
--  1. Capture metadata (one row per screenshot)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_screenshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Free-text identity reported by the agent (e.g. "demo-user-01"); not a FK,
  -- since monitored machines are not necessarily app users.
  employee_id   text NOT NULL,
  device_id     text NOT NULL,
  captured_at   timestamptz NOT NULL,
  display_no    int  NOT NULL DEFAULT 1,
  /** path within the employee-screenshots storage bucket */
  storage_path  text NOT NULL,
  app           text,
  title         text,
  idle          boolean NOT NULL DEFAULT false,
  sha256        text,
  bytes         bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_screenshots_emp_time
  ON public.employee_screenshots (employee_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_screenshots_device_time
  ON public.employee_screenshots (device_id, captured_at DESC);

ALTER TABLE public.employee_screenshots ENABLE ROW LEVEL SECURITY;

-- Superadmin may read everything. Writes come from the service role (edge
-- function), which bypasses RLS, so no INSERT policy is needed for ingest.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employee_screenshots' AND policyname = 'superadmin can view employee_screenshots') THEN
    CREATE POLICY "superadmin can view employee_screenshots"
      ON public.employee_screenshots FOR SELECT TO authenticated
      USING (public.is_superadmin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employee_screenshots' AND policyname = 'superadmin can delete employee_screenshots') THEN
    CREATE POLICY "superadmin can delete employee_screenshots"
      ON public.employee_screenshots FOR DELETE TO authenticated
      USING (public.is_superadmin());
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
--  2. Private storage bucket for the images
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-screenshots', 'employee-screenshots', false)
ON CONFLICT (id) DO NOTHING;

-- Objects are keyed <device_id>/<YYYY-MM-DD>/<unixts>_<display>.webp.
-- Only the superadmin may read; the service role (ingest) bypasses RLS to write.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'superadmin can read employee-screenshots objects') THEN
    CREATE POLICY "superadmin can read employee-screenshots objects"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'employee-screenshots' AND public.is_superadmin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'superadmin can delete employee-screenshots objects') THEN
    CREATE POLICY "superadmin can delete employee-screenshots objects"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'employee-screenshots' AND public.is_superadmin());
  END IF;
END $$;
