-- ═══════════════════════════════════════════════════════════════════════════
-- Correction "Processed" outcome + a stale-literal fix on the existing lock
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Firm instruction (2026-08-05): once a correction is filed, a reviewer
-- should be able to record the department's eventual CPC/TRACES response —
-- "Processed with Default" or "Processed without Default" — the SAME two
-- values already used for the original return's work_status
-- (PROCESSED_WITH_DEFAULT_STATUS/PROCESSED_WITHOUT_DEFAULT_STATUS,
-- src/components/tds/TdsFilingsManager.tsx, added earlier the same day).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. New columns ───────────────────────────────────────────────────────────
ALTER TABLE public.tds_corrections
  ADD COLUMN IF NOT EXISTS processed_outcome text,
  ADD COLUMN IF NOT EXISTS processed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processed_by_name text,
  ADD COLUMN IF NOT EXISTS processed_at      timestamptz;

ALTER TABLE public.tds_corrections DROP CONSTRAINT IF EXISTS tds_corrections_processed_outcome_check;
ALTER TABLE public.tds_corrections
  ADD CONSTRAINT tds_corrections_processed_outcome_check
  CHECK (processed_outcome IS NULL OR processed_outcome IN ('Processed with Default', 'Processed without Default'));

ALTER TABLE public.tds_corrections DROP CONSTRAINT IF EXISTS tds_corrections_processed_outcome_requires_filed;
ALTER TABLE public.tds_corrections
  ADD CONSTRAINT tds_corrections_processed_outcome_requires_filed
  CHECK (processed_outcome IS NULL OR status = 'filed');

-- ── 2. Read-only-once-filed trigger: carve out the processed-outcome fields ──
-- Everything else about a filed correction stays exactly as read-only as it
-- was — this is the ONE exception, because it's recorded LATER, once the
-- department's response is known, not part of what was actually filed.
--
-- Compared via jsonb-minus-allowlist rather than an enumerated boolean check
-- (contrast tds_challan_block_when_locked's core_changed, 20260804172600) —
-- deliberately, so any FUTURE new column on this table is automatically
-- protected by default (included in the diff) instead of silently exempted
-- by an allowlist someone forgot to update.
CREATE OR REPLACE FUNCTION public.tds_correction_block_when_filed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status text;
  allowlist CONSTANT text[] := ARRAY['processed_outcome', 'processed_by', 'processed_by_name', 'processed_at', 'updated_at'];
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

-- ── 3. Stale-literal fix: the original-return lock never learned the split ──
-- tds_challan_block_when_locked / tds_deductee_block_when_locked
-- (20260804172600) still checked work_status against the single literal
-- 'Processed' — the split into 'Processed with Default'/'Processed without
-- Default' the same day (TdsFilingsManager.tsx's PROCESSED_WORK_STATUSES)
-- was applied everywhere in the frontend but missed these two DB triggers,
-- so a challan/deductee on an ALREADY-PROCESSED return would have silently
-- read as unlocked at the database layer the moment any filing actually
-- reached either new status (zero filings held it yet, so this was latent,
-- not yet triggered in production).
CREATE OR REPLACE FUNCTION public.tds_challan_block_when_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fid uuid;
  fstatus text;
  core_changed boolean;
BEGIN
  fid := COALESCE(NEW.filing_id, OLD.filing_id);
  IF fid IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT work_status INTO fstatus FROM public.tds_filings WHERE id = fid;
  IF fstatus IS NULL OR fstatus NOT IN ('Ready to File', 'Filed', 'Processed', 'Processed with Default', 'Processed without Default') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    core_changed := (
      NEW.total_challan_amount     IS DISTINCT FROM OLD.total_challan_amount OR
      NEW.total_tax_deposited      IS DISTINCT FROM OLD.total_tax_deposited OR
      NEW.surcharge_deposited      IS DISTINCT FROM OLD.surcharge_deposited OR
      NEW.education_cess_deposited IS DISTINCT FROM OLD.education_cess_deposited OR
      NEW.interest_deposited       IS DISTINCT FROM OLD.interest_deposited OR
      NEW.others_deposited         IS DISTINCT FROM OLD.others_deposited OR
      NEW.late_fees_234e           IS DISTINCT FROM OLD.late_fees_234e OR
      NEW.bsr_code                 IS DISTINCT FROM OLD.bsr_code OR
      NEW.challan_serial_no        IS DISTINCT FROM OLD.challan_serial_no OR
      NEW.deposit_date             IS DISTINCT FROM OLD.deposit_date OR
      NEW.section_code             IS DISTINCT FROM OLD.section_code OR
      NEW.minor_head_of_challan    IS DISTINCT FROM OLD.minor_head_of_challan OR
      NEW.is_book_entry            IS DISTINCT FROM OLD.is_book_entry OR
      NEW.transfer_voucher_no      IS DISTINCT FROM OLD.transfer_voucher_no OR
      NEW.cheque_dd_no             IS DISTINCT FROM OLD.cheque_dd_no OR
      NEW.bank_name                IS DISTINCT FROM OLD.bank_name OR
      NEW.challan_remarks          IS DISTINCT FROM OLD.challan_remarks OR
      NEW.filing_id                IS DISTINCT FROM OLD.filing_id
    );
    IF core_changed THEN
      RAISE EXCEPTION 'This challan belongs to a return that has reached % and is locked. Request edit access in Validate & Finalise to make changes.', fstatus
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This return has reached % and is locked. Request edit access in Validate & Finalise to make changes.', fstatus
    USING ERRCODE = 'check_violation';
END $$;

CREATE OR REPLACE FUNCTION public.tds_deductee_block_when_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fid uuid;
  fstatus text;
BEGIN
  fid := COALESCE(NEW.filing_id, OLD.filing_id);
  IF fid IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT work_status INTO fstatus FROM public.tds_filings WHERE id = fid;
  IF fstatus IN ('Ready to File', 'Filed', 'Processed', 'Processed with Default', 'Processed without Default') THEN
    RAISE EXCEPTION 'This entry belongs to a return that has reached % and is locked. Request edit access in Validate & Finalise to make changes.', fstatus
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- ── 4. Signature-guard fix: don't re-litigate history on an unrelated update ─
-- Found while verifying #2 above: 1 of 4 real filed corrections was filed
-- under the OLD single-signature model, before Signature 1 (prepared_at)
-- existed — 20260729210000's own backfill only ever populated the
-- approved_*/filed_* columns from the legacy signed_*, never prepared_at.
-- tds_correction_guard_signatures() re-validates prepared_at/approved_at and
-- the filed-requires-both-signatures rule on EVERY update, including one
-- that only sets processed_outcome — so the very first UPDATE ever attempted
-- against such a row since the two-stage migration (this one) failed with
-- "The preparer must sign before the correction can be approved.", even
-- though nothing about signatures was being touched. Never previously
-- exercised: tds_correction_block_when_filed already blocked ALL writes to
-- a filed row, so no update — for any reason — ever reached this trigger.
CREATE OR REPLACE FUNCTION public.tds_correction_guard_signatures()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The senior approver must be a different person from the preparer.
  IF NEW.approved_by IS NOT NULL
     AND NEW.prepared_by IS NOT NULL
     AND NEW.approved_by = NEW.prepared_by THEN
    RAISE EXCEPTION
      'The senior approval must be given by someone other than the preparer.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Senior approval cannot precede the preparer's signature — only checked
  -- when THIS statement actually touches one of the two timestamps.
  IF (TG_OP = 'INSERT' OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at OR NEW.approved_at IS DISTINCT FROM OLD.approved_at)
     AND NEW.approved_at IS NOT NULL AND NEW.prepared_at IS NULL THEN
    RAISE EXCEPTION
      'The preparer must sign before the correction can be approved.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Filing cannot precede both signatures — only checked when THIS statement
  -- is the one moving the row into 'filed'.
  IF (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
     AND NEW.status = 'filed' AND (NEW.prepared_at IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION
      'A correction can only be filed after both signatures are complete.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Stamp the filing time whenever it becomes filed and none was supplied.
  IF NEW.status = 'filed' AND NEW.filed_at IS NULL THEN
    NEW.filed_at := now();
  END IF;

  RETURN NEW;
END $$;
