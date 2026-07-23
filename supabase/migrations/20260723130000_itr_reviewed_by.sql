-- IT Returns: add a "Reviewed By" column to itr_profiles.
--
-- Mirrors prepared_by / checked_by (nullable FK to users, ON DELETE SET NULL).
-- The IT Returns Filing table auto-stamps this with the signed-in user when a
-- row's filing_status is set to "Reviewed", and clears it when the row is
-- reverted to "Data Pending". Idempotent so re-applying is safe.
ALTER TABLE public.itr_profiles
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
