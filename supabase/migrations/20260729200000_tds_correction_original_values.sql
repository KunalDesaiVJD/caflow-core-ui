-- ═══════════════════════════════════════════════════════════════════════════
-- Capture the pre-edit state so a correction can show Original vs Corrected
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A correction has to make every change obvious without the user diffing two
-- returns by eye: modified fields shown as original -> corrected, additions
-- badged, deletions kept and struck through.
--
-- Additions and deletions are already answerable from `action`. Modifications
-- are not — once a row is edited, the filed values are gone from that row.
--
-- They could be recovered by joining back through original_deductee_id /
-- original_challan_id (the filed originals are immutable, so the join is
-- sound), but a self-contained snapshot is cheaper to read, survives any
-- future reorganisation of the source rows, and cannot drift.
--
-- The snapshot is taken automatically, in the SAME trigger that flips a row to
-- 'modify' — the state immediately before the first edit IS the filed state,
-- so there is nothing for the application to remember to do.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tds_correction_challans
  ADD COLUMN IF NOT EXISTS original_values jsonb;
ALTER TABLE public.tds_correction_deductees
  ADD COLUMN IF NOT EXISTS original_values jsonb;

-- Replaces the function installed by 20260729190000, adding the snapshot.
CREATE OR REPLACE FUNCTION public.tds_correction_mark_modified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  changed boolean;
BEGIN
  IF NEW.action = 'unchanged' AND OLD.action = 'unchanged' THEN
    changed := (to_jsonb(NEW) - 'updated_at' - 'action' - 'original_values')
       IS DISTINCT FROM
               (to_jsonb(OLD) - 'updated_at' - 'action' - 'original_values');

    IF changed THEN
      NEW.action := 'modify';
      -- First edit only: keep the filed values exactly as they were.
      IF NEW.original_values IS NULL THEN
        NEW.original_values := to_jsonb(OLD)
          - 'original_values' - 'updated_at' - 'created_at' - 'action';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Same for a soft-deleted row: keep what was there when it was removed, so the
-- struck-through row can still show its values.
CREATE OR REPLACE FUNCTION public.tds_correction_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.action = 'add' OR OLD.action = 'delete' THEN
    RETURN OLD;  -- genuinely remove (or already removed)
  END IF;

  IF TG_TABLE_NAME = 'tds_correction_challans' THEN
    UPDATE public.tds_correction_challans
       SET action = 'delete',
           original_values = COALESCE(
             original_values,
             to_jsonb(OLD) - 'original_values' - 'updated_at' - 'created_at' - 'action'),
           updated_at = now()
     WHERE id = OLD.id;
  ELSE
    UPDATE public.tds_correction_deductees
       SET action = 'delete',
           original_values = COALESCE(
             original_values,
             to_jsonb(OLD) - 'original_values' - 'updated_at' - 'created_at' - 'action'),
           updated_at = now()
     WHERE id = OLD.id;
  END IF;

  RETURN NULL;  -- cancel the DELETE; the row survives, marked
END $$;
