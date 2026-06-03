-- Make audit_engagements delete cascade reliably to ALL child tables
-- ---------------------------------------------------------------------
-- Symptom (PARESHBHAI D DOBARIYA "both" engagement):
--   User clicked Delete in the UI. App's handleDeleteEngagement ran but
--   silently failed because audit_query_dispatch_log (and others) have
--   FK constraints referencing audit_engagements(id) WITHOUT
--   ON DELETE CASCADE. The toast was missed, the engagement remained,
--   and it kept appearing in the dropdown.
--
-- Root cause:
--   Across the migration history, ~10 tables declared their engagement_id
--   FK without ON DELETE CASCADE (most use it correctly, a minority don't).
--   That minority blocks every engagement delete.
--
-- Fix:
--   Scan pg_constraint and rewrite every blocking FK to either
--   ON DELETE CASCADE (for child tables) or ON DELETE SET NULL
--   (for the self-reference parent_engagement_id, which represents
--   PY shell linkage — deleting the CY shouldn't auto-delete the PY).
--
-- Result:
--   From now on, deleting an audit_engagements row will cleanly remove
--   ALL its dependent rows in one transaction — no more silent failures.
--   The app's handleDeleteEngagement still does explicit cleanup of
--   tally_* / worksheet_* tables for clarity, but it's no longer
--   required for correctness.

DO $$
DECLARE
  rec RECORD;
  new_action text;
  cmd text;
BEGIN
  FOR rec IN
    SELECT
      c.conname,
      c.conrelid::regclass::text AS qualified_table,
      c.conrelid                 AS table_oid,
      (SELECT attname FROM pg_attribute
         WHERE attrelid = c.conrelid AND attnum = c.conkey[1])
                                 AS column_name,
      c.confdeltype
    FROM pg_constraint c
    WHERE c.confrelid = 'public.audit_engagements'::regclass
      AND c.contype = 'f'
      AND c.confdeltype NOT IN ('c', 'n')   -- 'c' = CASCADE, 'n' = SET NULL
  LOOP
    -- Self-reference on audit_engagements (parent_engagement_id used for PY
    -- shells) → SET NULL.  All other child tables → CASCADE.
    IF rec.table_oid = 'public.audit_engagements'::regclass THEN
      new_action := 'SET NULL';
    ELSE
      new_action := 'CASCADE';
    END IF;

    RAISE NOTICE 'Rewriting FK % on %.% → ON DELETE %',
                 rec.conname, rec.qualified_table, rec.column_name, new_action;

    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      rec.qualified_table, rec.conname
    );
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I '
      'FOREIGN KEY (%I) REFERENCES public.audit_engagements(id) ON DELETE %s',
      rec.qualified_table, rec.conname, rec.column_name, new_action
    );
  END LOOP;
END $$;
