-- ═══════════════════════════════════════════════════════════════════════════
-- Correction filing needs the filed date + acknowledgement number
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260729220000 required proof of submission (a file) before a correction
-- could reach 'filed'. It left filed_at auto-filled and filing_reference
-- optional. Both are now mandatory too — the acknowledgement number is the
-- firm's actual proof of what was filed, not metadata, so it gets the same
-- database-level guard as the proof file rather than relying on the UI form
-- alone.

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

  -- NEW: filed date and acknowledgement number, same guard as the proof file.
  IF NEW.status = 'filed' AND NEW.filed_at IS NULL THEN
    RAISE EXCEPTION
      'Enter the date the correction was filed before marking it as filed.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'filed' AND COALESCE(NEW.filing_reference, '') = '' THEN
    RAISE EXCEPTION
      'Enter the acknowledgement number before marking the correction as filed.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;
