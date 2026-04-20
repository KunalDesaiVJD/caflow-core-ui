-- ─────────────────────────────────────────────────────────────────────────────
-- Classification persistence fixes
--
-- The wizard change-classification flow writes to three tables, but the deployed
-- schemas were missing several columns the UI already references.  This migration
-- brings the schema in line so the full flow (history row → per-FY snapshot →
-- live client update) succeeds end-to-end.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) client_classification_history — add enriched audit-trail columns
ALTER TABLE public.client_classification_history
  ADD COLUMN IF NOT EXISTS old_classification    text,
  ADD COLUMN IF NOT EXISTS new_classification    text,
  ADD COLUMN IF NOT EXISTS effective_from_fy     text,
  ADD COLUMN IF NOT EXISTS responsible_person_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes                 text;

-- 2) client_fy_classifications — needs responsible_person_id
ALTER TABLE public.client_fy_classifications
  ADD COLUMN IF NOT EXISTS responsible_person_id uuid;

-- 3) clients — the codebase everywhere references clients.classification (text),
--    but only the older jsonb `client_classification` column existed.  Add the
--    simple text column and backfill it from the current FY snapshot.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS classification text;

-- Backfill — grab the latest known classification per client from the FY table.
UPDATE public.clients c
SET classification = fc.classification
FROM (
  SELECT DISTINCT ON (client_id) client_id, classification
  FROM public.client_fy_classifications
  ORDER BY client_id, financial_year DESC
) fc
WHERE fc.client_id = c.id
  AND c.classification IS NULL;
