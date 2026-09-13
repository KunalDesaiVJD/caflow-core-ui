-- Record which seller each slice of a payment actually went to.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- tds_property_instalments stores one figure per payment — amount_paid_by_buyer
-- — and the engine spreads it across every seller pro-rata by share_pct. That
-- is right whenever the buyers are buying the whole property jointly, which is
-- most deals.
--
-- It is wrong on the deal this column exists for: two buyers and two sellers,
-- where buyer A takes seller X's half and buyer B takes seller Y's half.
-- Pro-rata turns that into four deductee rows at 25% each. The TOTAL tax is
-- identical, so nothing on screen looks wrong — but the deductee-wise split is
-- exactly what reaches each seller's 26AS and AIS. Seller X is credited with
-- tax on money they never received, their real credit is short by the same
-- amount, and neither seller can reconcile their own return.
--
-- ── Shape ──────────────────────────────────────────────────────────────────
--
-- JSONB, nullable, an array of {"seller_key": "<PAN or exact name>",
-- "amount": <rupees>}. NULL — the default and the overwhelming case — means
-- pro-rata, unchanged.
--
-- Once a payment carries an allocation the list is treated as COMPLETE: a
-- seller not named in it received nothing from that payment. The validator
-- refuses a list that does not total the payment, or that names a seller who
-- is not on the transaction, because either would silently move the taxable
-- base for everyone on that payment.
--
-- jsonb rather than a child table on purpose. An allocation has no identity of
-- its own, is never queried across transactions, and is always read and
-- written whole with its payment — a table would add a join and a cascade for
-- nothing. Validated in the application (form141Validate.ts), where the error
-- can name the seller and the shortfall, rather than in a CHECK that could
-- only say "constraint violated".
--
-- Additive: existing rows get NULL and behave exactly as before.

ALTER TABLE public.tds_property_instalments
  ADD COLUMN IF NOT EXISTS allocations JSONB;

COMMENT ON COLUMN public.tds_property_instalments.allocations IS
  'Optional [{seller_key, amount}] split of this payment across sellers. NULL = pro-rata by share_pct. When present the list must total amount_paid_by_buyer.';

-- Confirms itself when run by hand.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tds_property_instalments' AND column_name = 'allocations';
