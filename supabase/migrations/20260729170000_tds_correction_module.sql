-- ═══════════════════════════════════════════════════════════════════════════
-- TDS Correction Module
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A correction return revises TDS data already FILED for an earlier quarter /
-- financial year. The governing rule is that the original filed data is never
-- deleted or overwritten, so three versions coexist for a period:
--
--   1. Data Entry        — tds_challans / tds_deductees   (original, untouched)
--   2. Validate&Finalise — tds_recon_results / etc.       (original, untouched)
--   3. Correction        — the tables below               (the revised version)
--
-- Starting a correction SNAPSHOTS every filed challan and deductee into
-- tds_correction_challans / tds_correction_deductees with action='unchanged'.
-- Edits then flip a row to 'modify' or 'delete', and new rows arrive as 'add'.
-- The correction therefore renders as a complete picture of the revised return
-- while the source tables are never written to.
--
-- LIFECYCLE  draft -> pending -> filed        (rejected is an exit from pending)
--   • client or staff creates a draft and edits it
--   • submitting moves it to pending
--   • a staff user signs it: status=filed, signed_by/_name/_at recorded
--   • filed is terminal and READ-ONLY, enforced by trigger below (not just UI)
--
-- ISOLATION  clients reach only their own rows, via portal_client_ids().
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. portal_client_ids() ──────────────────────────────────────────────────
-- Re-declared here (CREATE OR REPLACE, idempotent) so this migration is
-- self-contained and does not depend on 20260729160000 having run first.
CREATE OR REPLACE FUNCTION public.portal_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.clients c
  WHERE c.deleted_at IS NULL
    AND c.is_active IS NOT FALSE
    AND (
      c.user_id = auth.uid()
      OR (
        c.email IS NOT NULL
        AND lower(c.email) = lower(
          (SELECT au.email FROM auth.users au WHERE au.id = auth.uid())
        )
      )
    )
$$;

GRANT EXECUTE ON FUNCTION public.portal_client_ids() TO authenticated;

-- ── 1. Correction header ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_corrections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_year     text NOT NULL,
  quarter            text NOT NULL,
  form_type          text NOT NULL,
  -- The filing being corrected. Kept nullable so a correction survives an
  -- filing row being reorganised; the FY/quarter/form above are the identity.
  original_filing_id uuid REFERENCES public.tds_filings(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'pending', 'filed', 'rejected')),
  reason             text,

  raised_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  raised_by_name     text,
  -- 'client' when raised from the portal, else the staff role. Recorded at
  -- write time because a user's role can change later.
  raised_by_role     text,
  raised_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at       timestamptz,

  -- Click-to-sign attestation. The signer is already authenticated; this
  -- records WHO signed and WHEN, which is what makes the correction filed.
  signed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  signed_by_name     text,
  signed_by_role     text,
  signed_at          timestamptz,

  rejected_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_at        timestamptz,
  rejection_reason   text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_corrections_client  ON public.tds_corrections (client_id);
CREATE INDEX IF NOT EXISTS idx_tds_corrections_firm    ON public.tds_corrections (firm_id);
CREATE INDEX IF NOT EXISTS idx_tds_corrections_period  ON public.tds_corrections (financial_year, quarter, form_type);
CREATE INDEX IF NOT EXISTS idx_tds_corrections_status  ON public.tds_corrections (status);

-- ── 2. Corrected challans ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_correction_challans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id          uuid NOT NULL REFERENCES public.tds_corrections(id) ON DELETE CASCADE,
  firm_id                uuid NOT NULL,
  client_id              uuid NOT NULL,
  -- The filed challan this row revises. NULL for action='add'.
  original_challan_id    uuid,
  action                 text NOT NULL DEFAULT 'unchanged'
                           CHECK (action IN ('unchanged', 'add', 'modify', 'delete')),

  form_type              text,
  financial_year         text,
  quarter                text,
  bsr_code               text,
  challan_serial_no      text,
  deposit_date           date,
  total_tax_deposited    numeric DEFAULT 0,
  surcharge_deposited    numeric DEFAULT 0,
  education_cess_deposited numeric DEFAULT 0,
  interest_deposited     numeric DEFAULT 0,
  others_deposited       numeric DEFAULT 0,
  total_challan_amount   numeric DEFAULT 0,
  late_fees_234e         numeric DEFAULT 0,
  minor_head_of_challan  text,
  is_book_entry          boolean DEFAULT false,
  transfer_voucher_no    text,
  cheque_dd_no           text,
  bank_name              text,
  section_code           text,
  challan_remarks        text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_corr_challans_corr ON public.tds_correction_challans (correction_id);

-- ── 3. Corrected deductees ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_correction_deductees (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id             uuid NOT NULL REFERENCES public.tds_corrections(id) ON DELETE CASCADE,
  -- Every row hangs off a challan IN THE CORRECTION, so an entry that moves to
  -- a different challan stays correctly linked (workflow step 5).
  correction_challan_id     uuid REFERENCES public.tds_correction_challans(id) ON DELETE CASCADE,
  firm_id                   uuid NOT NULL,
  client_id                 uuid NOT NULL,
  original_deductee_id      uuid,
  action                    text NOT NULL DEFAULT 'unchanged'
                              CHECK (action IN ('unchanged', 'add', 'modify', 'delete')),

  form_type                 text,
  financial_year            text,
  quarter                   text,
  deductee_name             text,
  deductee_pan              text,
  pan_not_available         boolean DEFAULT false,
  deductee_ref_no           text,
  deductee_type             text,
  section_code              text,
  nature_of_payment         text,
  amount_paid_credited      numeric,
  date_of_payment           date,
  date_of_deduction         date,
  rate_of_tds               numeric,
  tds_amount                numeric,
  surcharge_amount          numeric DEFAULT 0,
  cess_amount               numeric DEFAULT 0,
  total_tax_deducted        numeric,
  interest_amount           numeric DEFAULT 0,
  late_fees_amount          numeric DEFAULT 0,
  lower_deduction_certificate_no text,
  lower_deduction_rate      numeric,
  reason_for_lower_or_nil_deduction text,
  country_of_residence      text,
  gross_salary              numeric,
  standard_deduction_allowed numeric,
  net_taxable_salary        numeric,
  designation               text,
  remarks                   text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_corr_deductees_corr    ON public.tds_correction_deductees (correction_id);
CREATE INDEX IF NOT EXISTS idx_tds_corr_deductees_challan ON public.tds_correction_deductees (correction_challan_id);

-- ── 4. Audit trail ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_correction_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id uuid NOT NULL REFERENCES public.tds_corrections(id) ON DELETE CASCADE,
  firm_id       uuid,
  client_id     uuid,
  action_type   text NOT NULL,
  detail        text,
  old_value     text,
  new_value     text,
  actor_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name    text,
  actor_role    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_corr_audit_corr ON public.tds_correction_audit_log (correction_id);

-- ── 5. Filed corrections are immutable ──────────────────────────────────────
-- Read-only after filing is enforced HERE, not only in the UI: once a
-- correction is signed, neither it nor any of its lines can be changed by any
-- client of the API. The only permitted UPDATE on a filed header is the
-- no-op/idempotent one, so we simply reject every change.
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
  ELSE
    SELECT c.status INTO parent_status
    FROM public.tds_corrections c
    WHERE c.id = OLD.correction_id;
  END IF;

  IF parent_status = 'filed' THEN
    RAISE EXCEPTION 'This correction has been filed and is read-only.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_tds_corrections_readonly ON public.tds_corrections;
CREATE TRIGGER trg_tds_corrections_readonly
  BEFORE UPDATE OR DELETE ON public.tds_corrections
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_block_when_filed();

DROP TRIGGER IF EXISTS trg_tds_corr_challans_readonly ON public.tds_correction_challans;
CREATE TRIGGER trg_tds_corr_challans_readonly
  BEFORE UPDATE OR DELETE ON public.tds_correction_challans
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_block_when_filed();

DROP TRIGGER IF EXISTS trg_tds_corr_deductees_readonly ON public.tds_correction_deductees;
CREATE TRIGGER trg_tds_corr_deductees_readonly
  BEFORE UPDATE OR DELETE ON public.tds_correction_deductees
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_block_when_filed();

-- The signing UPDATE itself must get through: it is the transition INTO
-- 'filed', so OLD.status is still 'pending' and the trigger above allows it.

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.tds_corrections            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_correction_challans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_correction_deductees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_correction_audit_log   ENABLE ROW LEVEL SECURITY;

-- 6a. Staff: normal firm scope, on every table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tds_corrections', 'tds_correction_challans',
    'tds_correction_deductees', 'tds_correction_audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_corr_staff_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING ('
      '  public.current_user_role() IS DISTINCT FROM ''client'''
      '  AND (public.is_superadmin() OR firm_id = public.current_user_firm_id())'
      ') '
      'WITH CHECK ('
      '  public.current_user_role() IS DISTINCT FROM ''client'''
      '  AND (public.is_superadmin() OR firm_id = public.current_user_firm_id())'
      ')',
      'tds_corr_staff_all', t
    );
  END LOOP;
END $$;

-- 6b. Clients: read their own, on every table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tds_corrections', 'tds_correction_challans',
    'tds_correction_deductees', 'tds_correction_audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_corr_client_read_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (client_id IN (SELECT public.portal_client_ids()))',
      'tds_corr_client_read_own', t
    );
  END LOOP;
END $$;

-- 6c. Clients: RESTRICTIVE cap — a client can never touch a row that is not
-- their own, on any command, whatever other policy might allow.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tds_corrections', 'tds_correction_challans',
    'tds_correction_deductees', 'tds_correction_audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_corr_client_own_rows_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ('
      '  public.current_user_role() IS DISTINCT FROM ''client'''
      '  OR client_id IN (SELECT public.portal_client_ids())'
      ') '
      'WITH CHECK ('
      '  public.current_user_role() IS DISTINCT FROM ''client'''
      '  OR client_id IN (SELECT public.portal_client_ids())'
      ')',
      'tds_corr_client_own_rows_only', t
    );
  END LOOP;
END $$;

-- 6d. Clients: raise + edit their own request, but only while it is theirs to
-- edit, and never sign it. The header's own INSERT is capped to draft/pending
-- and the signing columns must stay empty.
DROP POLICY IF EXISTS "tds_corr_client_insert" ON public.tds_corrections;
CREATE POLICY "tds_corr_client_insert" ON public.tds_corrections
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT public.portal_client_ids())
    AND status IN ('draft', 'pending')
    AND signed_by IS NULL AND signed_at IS NULL
  );

DROP POLICY IF EXISTS "tds_corr_client_update" ON public.tds_corrections;
CREATE POLICY "tds_corr_client_update" ON public.tds_corrections
  FOR UPDATE TO authenticated
  USING (
    client_id IN (SELECT public.portal_client_ids())
    AND status IN ('draft', 'pending')
  )
  WITH CHECK (
    client_id IN (SELECT public.portal_client_ids())
    AND status IN ('draft', 'pending')
    AND signed_by IS NULL AND signed_at IS NULL
  );

DROP POLICY IF EXISTS "tds_corr_client_delete" ON public.tds_corrections;
CREATE POLICY "tds_corr_client_delete" ON public.tds_corrections
  FOR DELETE TO authenticated
  USING (
    client_id IN (SELECT public.portal_client_ids())
    AND status = 'draft'
  );

-- Line items: writable by the client only while the parent is draft/pending.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tds_correction_challans', 'tds_correction_deductees'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tds_corr_client_line_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING ('
      '  client_id IN (SELECT public.portal_client_ids())'
      '  AND EXISTS (SELECT 1 FROM public.tds_corrections c'
      '              WHERE c.id = correction_id AND c.status IN (''draft'', ''pending''))'
      ') '
      'WITH CHECK ('
      '  client_id IN (SELECT public.portal_client_ids())'
      '  AND EXISTS (SELECT 1 FROM public.tds_corrections c'
      '              WHERE c.id = correction_id AND c.status IN (''draft'', ''pending''))'
      ')',
      'tds_corr_client_line_write', t
    );
  END LOOP;
END $$;

-- Audit log: clients may append their own actions, never edit history.
DROP POLICY IF EXISTS "tds_corr_client_audit_insert" ON public.tds_correction_audit_log;
CREATE POLICY "tds_corr_client_audit_insert" ON public.tds_correction_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (client_id IN (SELECT public.portal_client_ids()));

-- ── 7. Realtime ─────────────────────────────────────────────────────────────
-- So a correction raised in the portal shows up on the staff dashboard (and a
-- staff signature shows up in the portal) without a refresh.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tds_corrections', 'tds_correction_challans', 'tds_correction_deductees'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;
