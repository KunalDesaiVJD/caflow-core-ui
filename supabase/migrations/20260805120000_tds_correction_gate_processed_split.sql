-- ═══════════════════════════════════════════════════════════════════════════
-- Correction sequencing gate — "Processed" split into two outcomes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Firm instruction (2026-08-05): the generic "Processed" work_status is
-- replaced going forward by two real CPC/TRACES outcomes, "Processed with
-- Default" and "Processed without Default" (src/components/tds/TdsFilingsManager.tsx's
-- own PROCESSED_WORK_STATUSES/isProcessedWorkStatus). Either one satisfies
-- the sequencing gate added in 20260804180500 — the bare legacy "Processed"
-- stays accepted too (defensive; zero filings hold that value as of this
-- migration, confirmed by direct query before writing this).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tds_correction_guard_sequencing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_work_status text;
  v_open_count  int;
BEGIN
  SELECT work_status INTO v_work_status
  FROM public.tds_filings
  WHERE client_id = NEW.client_id
    AND financial_year = NEW.financial_year
    AND quarter = NEW.quarter
    AND tds_forms @> ARRAY[NEW.form_type]
  LIMIT 1;

  IF v_work_status IS DISTINCT FROM 'Processed'
     AND v_work_status IS DISTINCT FROM 'Processed with Default'
     AND v_work_status IS DISTINCT FROM 'Processed without Default' THEN
    RAISE EXCEPTION
      'A correction can only be started once the original return is marked Processed with Default or Processed without Default (current status: %).',
      COALESCE(v_work_status, 'no filing found')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_open_count
  FROM public.tds_corrections
  WHERE client_id = NEW.client_id
    AND financial_year = NEW.financial_year
    AND quarter = NEW.quarter
    AND form_type = NEW.form_type
    AND status NOT IN ('filed', 'rejected');

  IF v_open_count > 0 THEN
    RAISE EXCEPTION
      'A correction is already in progress for this period. Resolve it (file or reject) before starting another.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;
