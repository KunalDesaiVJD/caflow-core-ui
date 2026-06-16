-- The IT Returns inline editor was hitting the INSERT branch on every
-- status change because the React Query cache kept the virtual id even
-- after a row was created — so each click produced a fresh duplicate.
-- Result: up to a dozen rows per (client, AY) for the same client,
-- and the canonical-row picker sometimes surfaced a stale "Data Pending"
-- row instead of the latest status the user set.
--
-- Step 1: dedupe in-place — for every (client_id, assessment_year,
--   firm_id) keep the highest-scoring row (most data filled in) and
--   drop the rest. The score mirrors src/pages/ItReturns.tsx
--   `scoreItrProfile()` so the picker's choice and the DB's choice
--   stay in sync.
-- Step 2: add a UNIQUE constraint so the duplication can never recur.
--   The client-side handler will be updated separately to swap the
--   virtual id for the real id after the first INSERT.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, assessment_year, firm_id
      ORDER BY
        (CASE WHEN filing_status IS NOT NULL AND filing_status <> 'Data Pending' THEN 8 ELSE 0 END
         + CASE WHEN itr_form          IS NOT NULL THEN 4 ELSE 0 END
         + CASE WHEN date_filed        IS NOT NULL THEN 4 ELSE 0 END
         + CASE WHEN acknowledgment_no IS NOT NULL THEN 3 ELSE 0 END
         + CASE WHEN upload_by         IS NOT NULL THEN 2 ELSE 0 END
         + CASE WHEN prepared_by       IS NOT NULL THEN 2 ELSE 0 END
         + CASE WHEN checked_by        IS NOT NULL THEN 2 ELSE 0 END
         + CASE WHEN remarks           IS NOT NULL THEN 1 ELSE 0 END
        ) DESC,
        id DESC
    ) AS rn
  FROM itr_profiles
)
DELETE FROM itr_profiles
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE itr_profiles
  DROP CONSTRAINT IF EXISTS itr_profiles_client_ay_firm_unique;

ALTER TABLE itr_profiles
  ADD CONSTRAINT itr_profiles_client_ay_firm_unique
  UNIQUE (client_id, assessment_year, firm_id);
