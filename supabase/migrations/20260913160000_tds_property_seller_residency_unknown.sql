-- Residency becomes a fact somebody asserts, not a default.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- tds_property_parties.residential_status has defaulted to 'resident' since
-- 20260907090000, and the agreement reader wrote 'resident' onto every seller
-- it extracted. Nothing in a sale deed states residency, so that default was
-- never a reading — it was a guess, made silently, on the one field that picks
-- WHICH STATUTE applies:
--
--     resident      section 393(1) Table Sl. No. 3(i)   1%, this form
--     non-resident  section 195                         ~20% + surcharge +
--                                                       cess, Form 27Q, under
--                                                       the buyer's own TAN
--
-- An NRI sale therefore computed 1% where roughly twenty-something was due,
-- produced a clean-looking statement, and left the BUYER carrying the whole
-- shortfall under section 201 with interest. On a ₹2.5 crore property that is
-- about ₹50 lakh of exposure manufactured by a column default.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
-- 'unknown' becomes a permitted value and the new default. The engine and the
-- validator both treat it as blocking, so a transaction cannot be marked ready
-- to file until a human has settled each seller's residency. The reader now
-- writes 'unknown' and reports the evidence it saw (foreign address, NRO/NRE
-- account, repatriation clause, power of attorney, passport instead of
-- Aadhaar) as a question rather than deciding.
--
-- ── Existing rows ──────────────────────────────────────────────────────────
--
-- Deliberately NOT migrated to 'unknown'. Rows already saying 'resident' were
-- either entered by a person, who asserted it, or extracted before this change
-- — and silently re-opening settled transactions would block filings that are
-- already correct. New work gets the safe default; old work keeps what it has.
-- Anything filed on a wrong residency is a correction, not a migration.

ALTER TABLE public.tds_property_parties
  DROP CONSTRAINT IF EXISTS tds_property_parties_residential_status_check;

ALTER TABLE public.tds_property_parties
  ADD CONSTRAINT tds_property_parties_residential_status_check
  CHECK (residential_status IN ('resident', 'non_resident', 'unknown'));

ALTER TABLE public.tds_property_parties
  ALTER COLUMN residential_status SET DEFAULT 'unknown';

-- Confirms itself when run by hand: the new default and the widened check.
SELECT column_default
FROM information_schema.columns
WHERE table_name = 'tds_property_parties' AND column_name = 'residential_status';
