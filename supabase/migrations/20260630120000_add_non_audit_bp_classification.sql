-- Add "Non-Audit (BP)" as a valid client classification.
--
-- Business context: proprietor / small non-audit clients whose ITR due
-- date is 31 August (Business & Profession) instead of the regular
-- 31 July non-audit due date. Bifurcating this at the classification
-- level lets the IT Returns module surface a dedicated tab so due-date
-- planning can distinguish the two 31.07 vs 31.08 buckets.
--
-- Only `client_fy_classifications.classification` has a CHECK constraint
-- gating the allowed values — `client_classification_history.classification`
-- and `clients.classification` are unconstrained `text` and need no change.

ALTER TABLE public.client_fy_classifications
  DROP CONSTRAINT IF EXISTS client_fy_classifications_classification_check;

ALTER TABLE public.client_fy_classifications
  ADD CONSTRAINT client_fy_classifications_classification_check
  CHECK (classification IN (
    'Audit',
    'Non-Audit',
    'Non-Audit (BP)',
    'Partner in Audited Firm',
    'Not Applicable'
  ));
