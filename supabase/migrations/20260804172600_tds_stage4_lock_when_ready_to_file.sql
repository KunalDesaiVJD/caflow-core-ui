-- ═══════════════════════════════════════════════════════════════════════════
-- Stage 4 — Ready to File lock, enforced at the database layer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Today the "Ready to File" lock (LOCKED_WORK_STATUSES in TdsDataEntry.tsx)
-- is UI-only: every write function checks isFilingLocked in React state
-- before calling supabase, but nothing stops a direct REST/API call once a
-- return has reached Ready to File / Filed / Processed. This migration adds
-- the real boundary, mirroring the one existing precedent for a DB-level
-- write-block in this schema: tds_correction_block_when_filed() (see
-- 20260729170000_tds_correction_module.sql).
--
-- The unlock path is already fully built (tds_edit_requests +
-- TdsValidateFinalise.tsx's submitEditRequest/approveEditRequest/
-- rejectEditRequest, Firm Admin/Super Admin gated via canSign) — approving a
-- request calls handleRevokeSignature(), which reverts work_status away from
-- 'Ready to File' back to 'Reviewed'. Since these triggers key off the
-- CURRENT work_status, that revert is all it takes to re-open writes; no
-- separate bypass logic is needed here.
--
-- ── tds_challans: a NARROWER lock than "any write to a locked filing's row" ──
-- A challan can be legitimately consumed by a LATER, still-open quarter as
-- carry-forward (see rateEngine.ts / TdsDataEntry.tsx's extensive carry-
-- forward documentation) — as of 2026-08-04 there are 22 live deductee rows
-- doing exactly this, attached to a challan whose OWN origin filing is
-- already Filed. Blocking every UPDATE to such a challan would break
-- archiving it and recording its Kasar-Vatav write-off from that LATER
-- quarter's screen — both of which are ongoing bookkeeping actions that
-- correctly continue after the origin quarter is locked, not edits to what
-- was actually filed. So: INSERT and DELETE are always blocked once the
-- filing is locked (you cannot add a new challan to, or remove one from, a
-- return that's Ready to File or beyond); UPDATE is blocked only when a
-- field describing what was actually deposited/filed changes — is_archived,
-- kasar_vatav_*, and late_fees_used stay editable regardless.
--
-- ── tds_deductees: no such carve-out is needed ──────────────────────────────
-- A deductee's own filing_id always identifies which quarter's return it
-- belongs to — even one entered against an earlier quarter's carry-forward
-- challan carries the CURRENT (unlocked) quarter's filing_id, never the
-- challan's origin filing_id. So checking the deductee's own filing_id is
-- already carry-forward-safe with no field-level distinction required.

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
  IF fstatus IS NULL OR fstatus NOT IN ('Ready to File', 'Filed', 'Processed') THEN
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

DROP TRIGGER IF EXISTS trg_tds_challans_locked ON public.tds_challans;
CREATE TRIGGER trg_tds_challans_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.tds_challans
  FOR EACH ROW EXECUTE FUNCTION public.tds_challan_block_when_locked();

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
  IF fstatus IN ('Ready to File', 'Filed', 'Processed') THEN
    RAISE EXCEPTION 'This entry belongs to a return that has reached % and is locked. Request edit access in Validate & Finalise to make changes.', fstatus
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_tds_deductees_locked ON public.tds_deductees;
CREATE TRIGGER trg_tds_deductees_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.tds_deductees
  FOR EACH ROW EXECUTE FUNCTION public.tds_deductee_block_when_locked();
