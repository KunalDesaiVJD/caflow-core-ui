-- Add an optional user-editable label to saved MSME 43B(h) runs, so a run can
-- be named (e.g. "FY25-26 final", "pre-audit draft") and renamed later.
--
-- SAFETY: additive + idempotent (ADD COLUMN IF NOT EXISTS). Append-only w.r.t.
-- the base table migration (20260728140000_msme_43b_runs.sql), so it applies
-- correctly whether or not that migration has already been run.

ALTER TABLE public.msme_43b_runs
  ADD COLUMN IF NOT EXISTS label text;
