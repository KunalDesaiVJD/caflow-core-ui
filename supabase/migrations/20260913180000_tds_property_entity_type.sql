-- Give a party a constitution, so its PAN can be checked against it.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- Every field-level rule the firm asked for turns out to need one missing
-- column. "An HUF must have an HUF PAN", "a partnership firm must not carry
-- its partners' names", "a company's PAN must be a company PAN" — none of them
-- can be expressed while a party has a name and a PAN and nothing that says
-- what KIND of person it is.
--
-- The fourth character of a PAN already encodes exactly that, and the app
-- already knows the map (PAN_4TH_CHAR_MAP in src/lib/tds/rateEngine.ts):
--
--     P Individual   H HUF          C Company        F Firm/LLP   A AOP
--     T Trust        B BOI          L Local Authority J AJP       G Government
--
-- Until now that character was only checked for being a RECOGNISED letter, and
-- only as a warning. With the constitution recorded alongside, the two can be
-- cross-checked: an HUF seller whose PAN reads ...P... is either the karta's
-- personal PAN used by mistake — which credits the tax to the wrong assessee
-- and leaves the HUF with none — or a mis-read. Both are worth stopping.
--
-- ── What this adds ─────────────────────────────────────────────────────────
--
-- entity_type, nullable, one of the ten constitutions above or NULL for "not
-- stated". Nullable rather than defaulted: a deed frequently does not say, and
-- a default would be the same silent guess that the residential_status default
-- turned out to be. Where it is NULL the app infers a SUGGESTION from the PAN
-- and asks, rather than recording an answer nobody gave.
--
-- Additive: existing rows get NULL and nothing changes for them until someone
-- opens the transaction.

ALTER TABLE public.tds_property_parties
  ADD COLUMN IF NOT EXISTS entity_type TEXT;

ALTER TABLE public.tds_property_parties
  DROP CONSTRAINT IF EXISTS tds_property_parties_entity_type_check;

ALTER TABLE public.tds_property_parties
  ADD CONSTRAINT tds_property_parties_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN (
    'individual', 'huf', 'company', 'firm_llp', 'aop',
    'trust', 'boi', 'local_authority', 'ajp', 'government'
  ));

COMMENT ON COLUMN public.tds_property_parties.entity_type IS
  'Constitution of the party. Cross-checked against the 4th character of the PAN; NULL means not yet established.';

-- Confirms itself when run by hand.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tds_property_parties' AND column_name = 'entity_type';
