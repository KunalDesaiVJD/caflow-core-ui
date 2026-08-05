-- ═══════════════════════════════════════════════════════════════════════════
-- Correction "Recommendations" loop — default reason + Dashboard status sync
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Firm instruction (2026-08-05): a return marked "Processed with Default"
-- needs a captured reason (shown in the new Recommendations tab), and once
-- a correction raised for it is filed and its own outcome recorded, the
-- ORIGINAL return's work_status should follow that outcome — so the
-- Dashboard always reflects the latest known state, and a return that comes
-- back "Processed with Default" AGAIN reappears in Recommendations for
-- another round, while "Processed without Default" resolves it.
--
-- Deliberately NOT a new stored "recommendation" table: the Recommendations
-- tab is just `tds_filings.work_status = 'Processed with Default'` (plus
-- the existing "no open correction in progress" check the sequencing gate
-- already computes, 20260804180500) — this trigger keeping work_status
-- authoritative is what makes the whole loop self-maintaining with no
-- separate bookkeeping to drift out of sync.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. New columns ───────────────────────────────────────────────────────────
ALTER TABLE public.tds_filings
  ADD COLUMN IF NOT EXISTS default_reason text;

ALTER TABLE public.tds_corrections
  ADD COLUMN IF NOT EXISTS default_reason text;

-- ── 2. Sync trigger: a correction's outcome drives the original's status ─────
-- Resolves the target tds_filings row the SAME way the sequencing-gate
-- trigger (20260804180500) already does — by client/FY/quarter/form, not
-- the nullable original_filing_id — so this works identically regardless of
-- how the correction was created (Recommendations, a manual draft, or a
-- client portal request).
CREATE OR REPLACE FUNCTION public.tds_correction_sync_filing_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.processed_outcome IS DISTINCT FROM OLD.processed_outcome THEN
    UPDATE public.tds_filings
    SET work_status = NEW.processed_outcome,
        default_reason = CASE WHEN NEW.processed_outcome = 'Processed with Default' THEN NEW.default_reason ELSE NULL END,
        last_updated_at = now()
    WHERE client_id = NEW.client_id
      AND financial_year = NEW.financial_year
      AND quarter = NEW.quarter
      AND tds_forms @> ARRAY[NEW.form_type];
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tds_corrections_sync_filing_status ON public.tds_corrections;
CREATE TRIGGER trg_tds_corrections_sync_filing_status
  AFTER UPDATE ON public.tds_corrections
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_sync_filing_status();

-- ── 3. Read-only-once-filed carve-out: extend the allowlist ──────────────────
-- default_reason travels alongside processed_outcome (20260805150000's own
-- carve-out) — same jsonb-minus-allowlist technique, one more column added.
CREATE OR REPLACE FUNCTION public.tds_correction_block_when_filed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status text;
  allowlist CONSTANT text[] := ARRAY['processed_outcome', 'processed_by', 'processed_by_name', 'processed_at', 'default_reason', 'updated_at'];
BEGIN
  IF TG_TABLE_NAME = 'tds_corrections' THEN
    parent_status := OLD.status;
    IF parent_status = 'filed' THEN
      IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - allowlist) = (to_jsonb(OLD) - allowlist) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'This correction has been filed and is read-only.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT c.status INTO parent_status
  FROM public.tds_corrections c WHERE c.id = OLD.correction_id;

  IF parent_status IN ('awaiting_senior', 'ready_to_file', 'filed') THEN
    RAISE EXCEPTION
      'This correction is awaiting approval or already authorised — its entries can no longer be changed.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
