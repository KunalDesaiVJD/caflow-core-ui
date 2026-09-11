-- ITR upload dialog now has THREE required attachments instead of two:
-- ITR Acknowledgement (ITR-V), Computation of Income, and the ITR Form
-- itself (the actual filled return, e.g. ITR-1..ITR-7, distinct from its
-- acknowledgement receipt).
--
-- The original 20260903190000 migration's `kind` value 'itr_form' actually
-- meant the ACKNOWLEDGEMENT (the UI label was corrected to "ITR
-- Acknowledgement" in a later commit, but the stored `kind` string was left
-- alone). Now that a genuinely separate "ITR Form" upload is being added,
-- that old value must be renamed first — otherwise 'itr_form' would mean
-- two different real-world documents depending on when the row was created.
--
-- Order matters: widen the CHECK constraint first so both the old value and
-- the new one can coexist during the rename, migrate existing data, THEN
-- tighten the constraint to the final 3-value set. By that point no row
-- still has the old 'itr_form' meaning "acknowledgement", so the string
-- 'itr_form' is safe to reuse for its new, correct meaning.
--
-- SAFETY: idempotent constraint swap (guarded), rename is a targeted UPDATE.

-- ────────────────────────────────────────────────────────────────────────────
--  1. Widen the CHECK so old + new kind values can coexist during the rename
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.itr_status_uploads DROP CONSTRAINT IF EXISTS itr_status_uploads_kind_check;
ALTER TABLE public.itr_status_uploads
  ADD CONSTRAINT itr_status_uploads_kind_check
  CHECK (kind IN ('itr_form', 'itr_acknowledgement', 'computation_of_income'));

-- ────────────────────────────────────────────────────────────────────────────
--  2. Rename existing rows: old 'itr_form' meant the Acknowledgement
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.itr_status_uploads SET kind = 'itr_acknowledgement' WHERE kind = 'itr_form';

-- ────────────────────────────────────────────────────────────────────────────
--  3. Tighten the CHECK to the final set — 'itr_form' now unambiguously
--     means the actual filed return form, never the acknowledgement.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.itr_status_uploads DROP CONSTRAINT itr_status_uploads_kind_check;
ALTER TABLE public.itr_status_uploads
  ADD CONSTRAINT itr_status_uploads_kind_check
  CHECK (kind IN ('itr_acknowledgement', 'computation_of_income', 'itr_form'));
