-- ════════════════════════════════════════════════════════════════════════════
-- TDS on Property — three gaps the first schema left open
-- ════════════════════════════════════════════════════════════════════════════
--
-- Follows 20260907090000_tds_property_form141.sql. Every column here is
-- additive and nullable (or defaulted), so applying it to a database already
-- holding transactions changes nothing about the rows in it.
--
-- ── 1. PAN operativeness ───────────────────────────────────────────────────
--
-- The engine read the rate from whether a PAN was PRESENT. But a PAN that
-- exists and is INOPERATIVE — not linked to Aadhaar — carries the same 20%
-- rate as no PAN at all. Nothing on the face of a sale deed reveals it and no
-- seller volunteers it, so it has to be recorded as its own fact.
--
-- On a ₹1 crore flat the difference between 1% and 20% is ₹19,00,000,
-- recovered from the BUYER with interest. This is the most expensive thing
-- the module could get wrong, and the firm already holds the data: the
-- tds_pan_verification_rows table carries pan_status from TRACES.
--
-- 'unknown' is the default and is deliberately NOT read as operative — it
-- produces a warning telling the firm to check, rather than a quiet 1%.
--
-- ── 2. Section 395(1) certificate limits ───────────────────────────────────
--
-- A lower-deduction certificate was stored as a number and a rate, which
-- treats it as a standing concession. It is not: it authorises deductions
-- made inside a validity window, up to a stated amount. Without those two
-- facts the concessional rate is applied to the whole consideration, for
-- ever — a short deduction on everything past the ceiling or past the expiry.
--
-- ── 3. Which stamp duty value governs ──────────────────────────────────────
--
-- Where a deed is agreed in one year and registered in the next, two circle
-- rates exist. Where part-consideration moved on or before the agreement date
-- through a banking channel, the AGREEMENT-date value governs — and the
-- figure printed on the Index-II page is the registration-date one. The
-- software cannot settle that question of fact, so it records both dates and
-- raises it.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1 & 2. Parties ─────────────────────────────────────────────────────────

ALTER TABLE public.tds_property_parties
  ADD COLUMN IF NOT EXISTS pan_status TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tds_property_parties_pan_status'
  ) THEN
    ALTER TABLE public.tds_property_parties
      ADD CONSTRAINT tds_property_parties_pan_status
      CHECK (pan_status IN ('unknown', 'operative', 'inoperative', 'invalid'));
  END IF;
END $$;

ALTER TABLE public.tds_property_parties
  ADD COLUMN IF NOT EXISTS section_395_valid_from     DATE,
  ADD COLUMN IF NOT EXISTS section_395_valid_to       DATE,
  ADD COLUMN IF NOT EXISTS section_395_ceiling_amount NUMERIC(18,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tds_property_cert_window_ordered'
  ) THEN
    ALTER TABLE public.tds_property_parties
      ADD CONSTRAINT tds_property_cert_window_ordered
      CHECK (
        section_395_valid_from IS NULL
        OR section_395_valid_to IS NULL
        OR section_395_valid_from <= section_395_valid_to
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tds_property_cert_ceiling_positive'
  ) THEN
    ALTER TABLE public.tds_property_parties
      ADD CONSTRAINT tds_property_cert_ceiling_positive
      CHECK (section_395_ceiling_amount IS NULL OR section_395_ceiling_amount > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.tds_property_parties.pan_status IS
  'Operativeness of the deductee''s PAN. inoperative/invalid carry the 20% no-PAN rate; unknown means nobody has checked and produces a warning.';
COMMENT ON COLUMN public.tds_property_parties.section_395_ceiling_amount IS
  'Total amount the s.395(1) certificate covers. Tax beyond it reverts to the standard rate.';

-- ─── 3. Transactions ────────────────────────────────────────────────────────

ALTER TABLE public.tds_property_transactions
  ADD COLUMN IF NOT EXISTS date_of_registration   DATE,
  ADD COLUMN IF NOT EXISTS stamp_duty_value_as_on DATE;

COMMENT ON COLUMN public.tds_property_transactions.date_of_registration IS
  'When the deed was registered, where that differs from the agreement date. Null for an unregistered draft agreement.';
COMMENT ON COLUMN public.tds_property_transactions.stamp_duty_value_as_on IS
  'The date total_stamp_duty_value is taken as at — agreement date or registration date. Decides which circle rate governs.';
