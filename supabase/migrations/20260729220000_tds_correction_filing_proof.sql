-- ═══════════════════════════════════════════════════════════════════════════
-- Correction filing needs PROOF
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Marking a correction "Filed" is a claim that the return reached the Income
-- Tax Department. That claim now has to carry evidence:
--
--   offline submission -> the Acknowledgement (ACK) file
--   online  submission -> a screenshot of the submission
--
-- Both signatures authorise the correction; the proof is what closes it. The
-- requirement is enforced in the DATABASE, not just by a disabled button, so
-- a correction can never reach 'filed' without it.

ALTER TABLE public.tds_corrections
  ADD COLUMN IF NOT EXISTS submission_mode   text,
  ADD COLUMN IF NOT EXISTS proof_file_name   text,
  ADD COLUMN IF NOT EXISTS proof_file_url    text,
  ADD COLUMN IF NOT EXISTS proof_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS proof_uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tds_corrections_submission_mode_check'
  ) THEN
    ALTER TABLE public.tds_corrections
      ADD CONSTRAINT tds_corrections_submission_mode_check
      CHECK (submission_mode IS NULL OR submission_mode IN ('offline', 'online'));
  END IF;
END $$;

-- Extend the existing signature guard: filing already required both
-- signatures; it now also requires a submission mode and an uploaded file.
CREATE OR REPLACE FUNCTION public.tds_correction_guard_signatures()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.approved_by IS NOT NULL
     AND NEW.prepared_by IS NOT NULL
     AND NEW.approved_by = NEW.prepared_by THEN
    RAISE EXCEPTION
      'The senior approval must be given by someone other than the preparer.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.approved_at IS NOT NULL AND NEW.prepared_at IS NULL THEN
    RAISE EXCEPTION
      'The preparer must sign before the correction can be approved.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'filed' AND (NEW.prepared_at IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION
      'A correction can only be filed after both signatures are complete.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- NEW: proof of submission.
  IF NEW.status = 'filed' AND NEW.submission_mode IS NULL THEN
    RAISE EXCEPTION
      'Choose how the correction was submitted (offline or online) before filing it.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'filed' AND COALESCE(NEW.proof_file_url, '') = '' THEN
    RAISE EXCEPTION
      'Upload the acknowledgement (offline) or a submission screenshot (online) before filing.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'filed' AND NEW.filed_at IS NULL THEN
    NEW.filed_at := now();
  END IF;

  RETURN NEW;
END $$;

-- Clients may never write the proof columns either — same rule as the
-- signature columns. Rebuilt here so the WITH CHECK covers the new fields.
DROP POLICY IF EXISTS "tds_corr_client_insert" ON public.tds_corrections;
CREATE POLICY "tds_corr_client_insert" ON public.tds_corrections
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT public.portal_client_ids())
    AND status IN ('draft', 'awaiting_employee')
    AND prepared_by IS NULL AND prepared_at IS NULL
    AND approved_by IS NULL AND approved_at IS NULL
    AND filed_by    IS NULL AND filed_at    IS NULL
    AND submission_mode IS NULL AND proof_file_url IS NULL
  );

DROP POLICY IF EXISTS "tds_corr_client_update" ON public.tds_corrections;
CREATE POLICY "tds_corr_client_update" ON public.tds_corrections
  FOR UPDATE TO authenticated
  USING (
    client_id IN (SELECT public.portal_client_ids())
    AND status IN ('draft', 'awaiting_employee')
  )
  WITH CHECK (
    client_id IN (SELECT public.portal_client_ids())
    AND status IN ('draft', 'awaiting_employee')
    AND prepared_by IS NULL AND prepared_at IS NULL
    AND approved_by IS NULL AND approved_at IS NULL
    AND filed_by    IS NULL AND filed_at    IS NULL
    AND submission_mode IS NULL AND proof_file_url IS NULL
  );
