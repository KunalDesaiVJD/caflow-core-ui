-- ═══════════════════════════════════════════════════════════════════════════
-- Correction: two-stage signature, then MANUAL filing
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Approval and filing are different events. Two signatures AUTHORISE the
-- correction; filing happens later, when a human confirms the return was
-- actually accepted by the Income Tax Department.
--
--   draft
--     -> submit                 -> awaiting_employee   (preparer must sign)
--     -> preparer signs         -> awaiting_senior     (senior must approve)
--     -> senior signs           -> ready_to_file       (authorised, NOT filed)
--     -> "Mark as Filed"        -> filed               (locked, read-only)
--   awaiting_senior -> reject   -> rejected            (back to the preparer)
--
-- Nothing auto-files. ready_to_file is a terminal state until a person acts.
--
-- Maker-checker is enforced in the DATABASE: the senior approver can never be
-- the same person as the preparer, so the control cannot be bypassed by
-- calling the API directly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Signature + filing columns ───────────────────────────────────────────
ALTER TABLE public.tds_corrections
  ADD COLUMN IF NOT EXISTS prepared_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prepared_by_name  text,
  ADD COLUMN IF NOT EXISTS prepared_by_role  text,
  ADD COLUMN IF NOT EXISTS prepared_at       timestamptz,

  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_name  text,
  ADD COLUMN IF NOT EXISTS approved_by_role  text,
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,

  ADD COLUMN IF NOT EXISTS filed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS filed_by_name     text,
  ADD COLUMN IF NOT EXISTS filed_at          timestamptz,
  -- The acknowledgement the department returns, captured at manual filing.
  ADD COLUMN IF NOT EXISTS filing_reference  text;

-- ── 2. New status vocabulary ────────────────────────────────────────────────
-- Existing data has to move first, or the new CHECK would reject it.
-- The read-only trigger blocks any UPDATE on a filed correction, so suspend it
-- for this migration's backfill and restore it immediately after.
ALTER TABLE public.tds_corrections DISABLE TRIGGER trg_tds_corrections_readonly;

ALTER TABLE public.tds_corrections DROP CONSTRAINT IF EXISTS tds_corrections_status_check;

-- A correction that was already signed under the old single-signature model
-- keeps its signature as the SENIOR approval, and — since the old "sign"
-- action also filed it — as the filing record too.
UPDATE public.tds_corrections
   SET approved_by      = COALESCE(approved_by, signed_by),
       approved_by_name = COALESCE(approved_by_name, signed_by_name),
       approved_by_role = COALESCE(approved_by_role, signed_by_role),
       approved_at      = COALESCE(approved_at, signed_at),
       filed_by         = COALESCE(filed_by, signed_by),
       filed_by_name    = COALESCE(filed_by_name, signed_by_name),
       filed_at         = COALESCE(filed_at, signed_at)
 WHERE status = 'filed';

-- 'pending' meant "submitted, awaiting a signature" — that is now the
-- preparer's own signature stage.
UPDATE public.tds_corrections SET status = 'awaiting_employee' WHERE status = 'pending';

ALTER TABLE public.tds_corrections
  ADD CONSTRAINT tds_corrections_status_check
  CHECK (status IN (
    'draft', 'awaiting_employee', 'awaiting_senior',
    'ready_to_file', 'filed', 'rejected'
  ));

ALTER TABLE public.tds_corrections ENABLE TRIGGER trg_tds_corrections_readonly;

-- ── 3. Maker-checker, enforced in the database ──────────────────────────────
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

  -- Senior approval cannot precede the preparer's signature.
  IF NEW.approved_at IS NOT NULL AND NEW.prepared_at IS NULL THEN
    RAISE EXCEPTION
      'The preparer must sign before the correction can be approved.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Filing cannot precede both signatures.
  IF NEW.status = 'filed' AND (NEW.prepared_at IS NULL OR NEW.approved_at IS NULL) THEN
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

DROP TRIGGER IF EXISTS trg_tds_corrections_signature_guard ON public.tds_corrections;
CREATE TRIGGER trg_tds_corrections_signature_guard
  BEFORE INSERT OR UPDATE ON public.tds_corrections
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_guard_signatures();

-- ── 4. Clients may still only touch their own pre-signature request ─────────
-- A client can create and edit a correction request while it is draft or
-- awaiting the employee signature, and may never write any signature column.
DROP POLICY IF EXISTS "tds_corr_client_insert" ON public.tds_corrections;
CREATE POLICY "tds_corr_client_insert" ON public.tds_corrections
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT public.portal_client_ids())
    AND status IN ('draft', 'awaiting_employee')
    AND prepared_by IS NULL AND prepared_at IS NULL
    AND approved_by IS NULL AND approved_at IS NULL
    AND filed_by    IS NULL AND filed_at    IS NULL
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
  );

-- Line items follow the parent: editable only before the first signature.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tds_correction_challans', 'tds_correction_deductees'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_corr_client_line_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING ('
      '  client_id IN (SELECT public.portal_client_ids())'
      '  AND EXISTS (SELECT 1 FROM public.tds_corrections c'
      '              WHERE c.id = correction_id'
      '                AND c.status IN (''draft'', ''awaiting_employee''))'
      ') '
      'WITH CHECK ('
      '  client_id IN (SELECT public.portal_client_ids())'
      '  AND EXISTS (SELECT 1 FROM public.tds_corrections c'
      '              WHERE c.id = correction_id'
      '                AND c.status IN (''draft'', ''awaiting_employee''))'
      ')',
      'tds_corr_client_line_write', t
    );
  END LOOP;
END $$;

-- ── 5. Line items freeze once the correction is authorised ──────────────────
-- Read-only at 'filed' is the audit guarantee (20260729170000). Editing after
-- the signatures but before filing would invalidate what was signed, so
-- ready_to_file and awaiting_senior are frozen for everyone too.
CREATE OR REPLACE FUNCTION public.tds_correction_block_when_filed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'tds_corrections' THEN
    parent_status := OLD.status;
    -- The header itself must still move through its own lifecycle; only a
    -- FILED correction is immutable.
    IF parent_status = 'filed' THEN
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
