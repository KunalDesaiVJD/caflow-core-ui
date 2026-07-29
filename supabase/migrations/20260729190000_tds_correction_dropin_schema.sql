-- ═══════════════════════════════════════════════════════════════════════════
-- Make the correction tables a DROP-IN for tds_challans / tds_deductees
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A correction is not a different kind of data — it is the same return, in a
-- second version. So the Correction screen must BE the Data Entry screen:
-- same challan cards, same utilised/unutilised balances, same validations,
-- calculations and dropdowns. The only difference is which tables it writes.
--
-- That is only cheap if the correction tables are column-identical to the live
-- ones, so every query in TdsDataEntry stays byte-identical apart from the
-- table NAME. This migration closes the gaps:
--
--   1. filing_id  — mirrors correction_id, so `.eq("filing_id", …)` and every
--      `d.filing_id` comparison in TdsDataEntry work unchanged. (The scope key
--      of a correction row IS its correction; the column is named filing_id
--      purely so the shared engine needs no special case.)
--   2. challan_id — replaces correction_challan_id for the same reason.
--   3. the challan utilisation columns TdsDataEntry relies on
--      (late_fees_used / fully_utilized / origin_quarter / origin_fy).
--
-- And it moves add/modify/delete tracking INTO the database, so the shared
-- engine does not have to know it is editing a correction at all:
--   • INSERT  → action defaults to 'add'   (seeding passes 'unchanged' explicitly)
--   • UPDATE  → an 'unchanged' row flips to 'modify' when real data changes
--   • DELETE  → a row that came from the filed return is marked 'delete'
--               instead of being removed; a row added in this correction is
--               genuinely removed.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Challans: add the columns the Data Entry engine expects ──────────────
ALTER TABLE public.tds_correction_challans
  ADD COLUMN IF NOT EXISTS filing_id      uuid,
  ADD COLUMN IF NOT EXISTS late_fees_used numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fully_utilized boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin_quarter text,
  ADD COLUMN IF NOT EXISTS origin_fy      text;

-- The read-only trigger from 20260729170000 rejects ANY update to a filed
-- correction — correctly, and it already blocked a first run of this file.
-- A schema backfill is not a user edit, so suspend it for the backfill only
-- and put it straight back. (DISABLE TRIGGER takes an ACCESS EXCLUSIVE lock
-- and is transactional, so it cannot leak to concurrent sessions.)
ALTER TABLE public.tds_correction_challans  DISABLE TRIGGER trg_tds_corr_challans_readonly;
ALTER TABLE public.tds_correction_deductees DISABLE TRIGGER trg_tds_corr_deductees_readonly;

UPDATE public.tds_correction_challans
   SET filing_id = correction_id
 WHERE filing_id IS DISTINCT FROM correction_id;

-- ── 2. Deductees: filing_id + challan_id ────────────────────────────────────
ALTER TABLE public.tds_correction_deductees
  ADD COLUMN IF NOT EXISTS filing_id  uuid,
  ADD COLUMN IF NOT EXISTS challan_id uuid;

UPDATE public.tds_correction_deductees
   SET filing_id = correction_id
 WHERE filing_id IS DISTINCT FROM correction_id;

UPDATE public.tds_correction_deductees
   SET challan_id = correction_challan_id
 WHERE challan_id IS DISTINCT FROM correction_challan_id;

-- Immutability restored immediately after the backfill.
ALTER TABLE public.tds_correction_challans  ENABLE TRIGGER trg_tds_corr_challans_readonly;
ALTER TABLE public.tds_correction_deductees ENABLE TRIGGER trg_tds_corr_deductees_readonly;

CREATE INDEX IF NOT EXISTS idx_tds_corr_deductees_challan_id
  ON public.tds_correction_deductees (challan_id);

-- ── 3. correction_id / filing_id stay in lock-step ──────────────────────────
-- The shared engine only ever sets filing_id (it thinks it is writing a
-- filing). correction_id is NOT NULL, so fill it from filing_id on the way in,
-- and vice-versa for the seeding path which sets correction_id.
CREATE OR REPLACE FUNCTION public.tds_correction_sync_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.correction_id IS NULL AND NEW.filing_id IS NOT NULL THEN
    NEW.correction_id := NEW.filing_id;
  ELSIF NEW.filing_id IS NULL AND NEW.correction_id IS NOT NULL THEN
    NEW.filing_id := NEW.correction_id;
  END IF;

  -- Correction rows carry the parent's firm/client; the engine does set these,
  -- but a NULL would break the RLS check, so backfill defensively.
  IF NEW.firm_id IS NULL OR NEW.client_id IS NULL THEN
    SELECT c.firm_id, c.client_id INTO NEW.firm_id, NEW.client_id
    FROM public.tds_corrections c WHERE c.id = NEW.correction_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_corr_challans_scope ON public.tds_correction_challans;
CREATE TRIGGER trg_corr_challans_scope
  BEFORE INSERT OR UPDATE ON public.tds_correction_challans
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_sync_scope();

DROP TRIGGER IF EXISTS trg_corr_deductees_scope ON public.tds_correction_deductees;
CREATE TRIGGER trg_corr_deductees_scope
  BEFORE INSERT OR UPDATE ON public.tds_correction_deductees
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_sync_scope();

-- Deductees additionally mirror challan_id <-> correction_challan_id.
CREATE OR REPLACE FUNCTION public.tds_correction_sync_challan_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.correction_challan_id IS NULL AND NEW.challan_id IS NOT NULL THEN
    NEW.correction_challan_id := NEW.challan_id;
  ELSIF NEW.challan_id IS NULL AND NEW.correction_challan_id IS NOT NULL THEN
    NEW.challan_id := NEW.correction_challan_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_corr_deductees_challan_ref ON public.tds_correction_deductees;
CREATE TRIGGER trg_corr_deductees_challan_ref
  BEFORE INSERT OR UPDATE ON public.tds_correction_deductees
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_sync_challan_ref();

-- ── 4. Change tracking lives in the database ────────────────────────────────
-- A new row is an addition unless the caller says otherwise. The seeding path
-- in createCorrection() passes action='unchanged' explicitly, so it still wins.
ALTER TABLE public.tds_correction_challans  ALTER COLUMN action SET DEFAULT 'add';
ALTER TABLE public.tds_correction_deductees ALTER COLUMN action SET DEFAULT 'add';

-- An untouched copy of a filed row becomes 'modify' the moment real data
-- changes. Rows already marked add/modify/delete keep their marking.
CREATE OR REPLACE FUNCTION public.tds_correction_mark_modified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.action = 'unchanged' AND OLD.action = 'unchanged' THEN
    -- to_jsonb comparison minus the bookkeeping columns: if anything the user
    -- can actually see differs, this is a modification.
    IF (to_jsonb(NEW) - 'updated_at' - 'action') IS DISTINCT FROM
       (to_jsonb(OLD) - 'updated_at' - 'action') THEN
      NEW.action := 'modify';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_corr_challans_modified ON public.tds_correction_challans;
CREATE TRIGGER trg_corr_challans_modified
  BEFORE UPDATE ON public.tds_correction_challans
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_mark_modified();

DROP TRIGGER IF EXISTS trg_corr_deductees_modified ON public.tds_correction_deductees;
CREATE TRIGGER trg_corr_deductees_modified
  BEFORE UPDATE ON public.tds_correction_deductees
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_mark_modified();

-- Deleting a row that came from the filed return must PRESERVE it, marked
-- 'delete', so the correction still shows what was removed. A row added inside
-- this correction has no filed original, so it really is deleted.
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
       SET action = 'delete', updated_at = now() WHERE id = OLD.id;
  ELSE
    UPDATE public.tds_correction_deductees
       SET action = 'delete', updated_at = now() WHERE id = OLD.id;
  END IF;

  RETURN NULL;  -- cancel the DELETE; the row survives, marked
END $$;

DROP TRIGGER IF EXISTS trg_corr_challans_softdel ON public.tds_correction_challans;
CREATE TRIGGER trg_corr_challans_softdel
  BEFORE DELETE ON public.tds_correction_challans
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_soft_delete();

DROP TRIGGER IF EXISTS trg_corr_deductees_softdel ON public.tds_correction_deductees;
CREATE TRIGGER trg_corr_deductees_softdel
  BEFORE DELETE ON public.tds_correction_deductees
  FOR EACH ROW EXECUTE FUNCTION public.tds_correction_soft_delete();

-- ── 5. Filed corrections stay immutable ─────────────────────────────────────
-- The read-only trigger from 20260729170000 fires BEFORE UPDATE/DELETE and
-- raises, so it still wins over everything added above regardless of order.
