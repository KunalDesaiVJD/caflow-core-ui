-- ═══════════════════════════════════════════════════════════════════════════
-- A row edited back to its filed values is no longer a change
-- ═══════════════════════════════════════════════════════════════════════════
--
-- tds_correction_mark_modified() only ever moved a row FORWARD:
-- unchanged -> modify. So a user who edited an entry, thought better of it and
-- typed the original values back by hand was left with a row still marked
-- 'modify' and still carrying its snapshot — rendering as a "Modified" row
-- PLUS an "Original" comparison row holding identical data. Two rows, one
-- entry, no difference between them.
--
-- The marking now clears itself: if an update leaves every meaningful column
-- equal to the snapshot, the row goes back to 'unchanged' and the snapshot is
-- dropped, making it indistinguishable from an entry that was never touched —
-- exactly as if Undo had been used.
--
-- Comparison is value-aware, not jsonb-literal-aware, because:
--   • numeric 10000 and 10000.00 are the same amount but different jsonb
--   • an emptied field arrives as '' from one path and NULL from another
-- Both normalisations mirror diffCorrectionRow() in src/lib/tdsCorrections.ts,
-- so the database and the UI agree on what "changed" means.

CREATE OR REPLACE FUNCTION public.tds_correction_mark_modified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  k         text;
  snap_val  jsonb;
  cur_val   jsonb;
  cur_row   jsonb;
  differs   boolean := false;
  changed   boolean;
BEGIN
  -- ── unchanged -> modify (with snapshot), as before ────────────────────────
  IF NEW.action = 'unchanged' AND OLD.action = 'unchanged' THEN
    changed := (to_jsonb(NEW) - 'updated_at' - 'action' - 'original_values')
       IS DISTINCT FROM
               (to_jsonb(OLD) - 'updated_at' - 'action' - 'original_values');

    IF changed THEN
      NEW.action := 'modify';
      IF NEW.original_values IS NULL THEN
        NEW.original_values := to_jsonb(OLD)
          - 'original_values' - 'updated_at' - 'created_at' - 'action';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- ── modify -> unchanged, when the row matches its snapshot again ───────────
  IF NEW.action = 'modify' AND NEW.original_values IS NOT NULL THEN
    cur_row := to_jsonb(NEW);

    FOR k, snap_val IN SELECT key, value FROM jsonb_each(NEW.original_values) LOOP
      IF k IN ('id', 'action', 'original_values', 'updated_at', 'created_at') THEN
        CONTINUE;
      END IF;

      cur_val := cur_row -> k;

      -- treat JSON null and '' as the same "empty"
      IF COALESCE(snap_val, 'null'::jsonb) IN ('null'::jsonb, '""'::jsonb)
         AND COALESCE(cur_val, 'null'::jsonb) IN ('null'::jsonb, '""'::jsonb) THEN
        CONTINUE;
      END IF;

      IF jsonb_typeof(snap_val) = 'number' AND jsonb_typeof(cur_val) = 'number' THEN
        -- 10000 vs 10000.00 is the same amount
        IF (snap_val #>> '{}')::numeric <> (cur_val #>> '{}')::numeric THEN
          differs := true;
          EXIT;
        END IF;
      ELSIF COALESCE(snap_val #>> '{}', '') <> COALESCE(cur_val #>> '{}', '') THEN
        differs := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT differs THEN
      NEW.action := 'unchanged';
      NEW.original_values := NULL;
    END IF;
  END IF;

  RETURN NEW;
END $$;
