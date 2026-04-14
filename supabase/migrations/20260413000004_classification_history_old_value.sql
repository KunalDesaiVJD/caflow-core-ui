-- ISSUE-21: Preserve before-state when classification changes.
-- Adds old_classification column to the existing client_classification_history table
-- so every row records the transition (old → new) rather than only the new value.

ALTER TABLE public.client_classification_history
  ADD COLUMN IF NOT EXISTS old_classification TEXT;

-- Back-fill: rows written before this migration have no old value — leave them NULL
-- so they are distinguishable from "was blank / first-time set" rows.

COMMENT ON COLUMN public.client_classification_history.old_classification
  IS 'Classification value before this change. NULL means the row was the first classification set for this client+FY, or was recorded before this column existed.';

COMMENT ON COLUMN public.client_classification_history.classification
  IS 'New classification value applied by this change.';
