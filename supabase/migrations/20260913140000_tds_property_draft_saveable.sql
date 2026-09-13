-- Let a part-built property transaction actually save as a draft.
--
-- ── What went wrong ────────────────────────────────────────────────────────
--
-- A user uploaded a registered deed, the reader filled in what it could, and
-- the Save button stayed greyed out with no way to make it go. Everything on
-- screen was lost on navigating away.
--
-- The cause is here, not in the UI. Three CHECK constraints demand a COMPLETE
-- transaction of every row, whatever its status:
--
--   tds_property_consideration_positive  total_sale_consideration > 0
--   tds_property_share_range             share_pct > 0 AND share_pct <= 100
--   tds_property_instalment_positive     amount_paid_by_buyer > 0
--
-- dbSaveBlockers() in propertyDeal.ts mirrors them so the user gets a readable
-- sentence instead of a Postgres violation — which is right, but it means a
-- deed whose consideration the reader could not find can never be saved at
-- all, not even as the draft it plainly is. A scanned Gujarati દસ્તાવેજ where
-- the figure sits in a table the vision model read as an image is exactly that
-- case, and it is common.
--
-- A draft is incomplete BY DEFINITION. Demanding completeness of one is a
-- category error, and the cost of it is the user's work.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
-- Each constraint is relaxed to permit zero, and the completeness demand moves
-- to where it belongs — the point of marking a transaction ready to file:
--
--   * transactions  a draft may carry 0; anything past draft must be > 0.
--                   Enforced here, because this table HAS the status column.
--   * parties       0 is allowed. A row-level CHECK cannot see the parent's
--   * instalments   status without a subquery, which CHECK forbids, so the
--                   "> 0 before filing" half is enforced by readyBlockers()
--                   in propertyDeal.ts and by the Form 141 validator, both of
--                   which already refuse to produce a statement from a zero
--                   share or a zero payment.
--
-- Nothing is dropped that guards a FILED transaction: negative values stay
-- impossible everywhere, shares over 100% stay impossible, and a transaction
-- still cannot leave draft with a zero consideration.
--
-- ── Safety ─────────────────────────────────────────────────────────────────
--
-- Relaxing a CHECK can never invalidate an existing row: everything that
-- satisfied the old constraint satisfies the new one. No data is touched and
-- no column changes type or nullability. Reversible by restoring the three
-- original definitions.

-- ── transactions ───────────────────────────────────────────────────────────
ALTER TABLE public.tds_property_transactions
  DROP CONSTRAINT IF EXISTS tds_property_consideration_positive;

ALTER TABLE public.tds_property_transactions
  ADD CONSTRAINT tds_property_consideration_positive
  CHECK (
    total_sale_consideration >= 0
    AND (status = 'draft' OR total_sale_consideration > 0)
  );

-- ── parties ────────────────────────────────────────────────────────────────
ALTER TABLE public.tds_property_parties
  DROP CONSTRAINT IF EXISTS tds_property_share_range;

ALTER TABLE public.tds_property_parties
  ADD CONSTRAINT tds_property_share_range
  CHECK (share_pct >= 0 AND share_pct <= 100);

-- ── instalments ────────────────────────────────────────────────────────────
ALTER TABLE public.tds_property_instalments
  DROP CONSTRAINT IF EXISTS tds_property_instalment_positive;

ALTER TABLE public.tds_property_instalments
  ADD CONSTRAINT tds_property_instalment_positive
  CHECK (amount_paid_by_buyer >= 0);

-- Shows the result, so running this by hand in the SQL editor confirms itself.
-- Three rows, each with the relaxed definition.
SELECT conrelid::regclass AS table_name,
       conname            AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
  'tds_property_consideration_positive',
  'tds_property_share_range',
  'tds_property_instalment_positive'
)
ORDER BY table_name;
