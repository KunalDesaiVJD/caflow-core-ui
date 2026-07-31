-- ─────────────────────────────────────────────────────────────────────────────
-- TDS challan archive
--
-- A challan that's no longer required (a stray duplicate, a leftover with a
-- balance nobody intends to use) previously had no way to be put away except
-- permanent delete — which is destructive and, worse, breaks the historical
-- link for any deductee still referencing it. Archiving is a soft, reversible
-- alternative: an archived challan drops out of the active challan list, the
-- Carry-Forward candidate list, and every balance/utilisation calculation
-- that depends on those, but the row (and its history) is untouched and can
-- be restored at any time.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tds_challans ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.tds_challans ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.tds_challans ADD COLUMN IF NOT EXISTS archived_by UUID;

CREATE INDEX IF NOT EXISTS idx_tds_challans_client_archived ON public.tds_challans(client_id, is_archived);

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_challans' AND column_name = 'is_archived') AS has_is_archived,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_challans' AND column_name = 'archived_at') AS has_archived_at,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_challans' AND column_name = 'archived_by') AS has_archived_by;
