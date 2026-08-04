-- ═══════════════════════════════════════════════════════════════════════════
-- Correction sequencing gate
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Firm instruction (2026-08-04): a correction may only be raised once the
-- ORIGINAL return is marked "Processed" (tds_filings.work_status), and a
-- SECOND correction for the same period may not be raised while an earlier
-- one for that period is still open (any status other than 'filed' or
-- 'rejected' — a rejected attempt is dead and must not block a fresh one).
--
-- Identity is (client_id, financial_year, quarter, form_type) — the same key
-- getEffectiveClientLedger() and createCorrection()'s own snapshot logic use
-- — not original_filing_id, which is nullable by design (tdsCorrections.ts's
-- own header comment: "Kept nullable so a correction survives a filing row
-- being reorganised; the FY/quarter/form above are the identity").
--
-- This is a DB-level backstop alongside the UI gating in
-- TdsCorrectionsModule.tsx / PortalCorrections.tsx — matches this module's
-- existing pattern (tds_correction_guard_signatures, 20260729210000) of
-- enforcing invariants in the database, not just the client.
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

  IF v_work_status IS DISTINCT FROM 'Processed' THEN
    RAISE EXCEPTION
      'A correction can only be started once the original return is marked Processed (current status: %).',
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

DROP TRIGGER IF EXISTS trg_tds_corrections_sequencing_guard ON public.tds_corrections;
CREATE TRIGGER trg_tds_corrections_sequencing_guard
  BEFORE INSERT ON public.tds_corrections
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_guard_sequencing();
