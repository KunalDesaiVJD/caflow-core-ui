-- CP-09: Add effective_from_fy to client_classification_history.
--
-- "effective_from_fy" records the first FY in which the NEW classification
-- takes effect, so FY-data loading can determine which classification was
-- active during any given financial year without touching other FY rows.
--
-- The column is nullable so existing rows (written before this migration)
-- are left as NULL — they are distinguishable from post-migration rows.

ALTER TABLE public.client_classification_history
  ADD COLUMN IF NOT EXISTS effective_from_fy TEXT;

COMMENT ON COLUMN public.client_classification_history.effective_from_fy
  IS 'The FY from which the new classification takes effect (= financial_year + 1). '
     'E.g. changing classification for FY 2024-25 → effective_from_fy = 2025-26. '
     'NULL for rows written before this column was added.';
