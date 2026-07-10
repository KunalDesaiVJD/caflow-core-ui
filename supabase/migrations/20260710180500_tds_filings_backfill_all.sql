-- One-time backfill: run the new sync function for every active TDS
-- client_services row, so all currently-configured clients get their full
-- set of tds_filings across [startFY .. current FY] immediately.
--
-- Fixes the accumulated gaps from the old lazy, per-FY, silently-throwing
-- client-side backfill:
--   • forms added but never generated (e.g. AMBER GUM's 24Q)
--   • ~255 rows across ~66 clients missing for FY 2025-26 because the
--     client-side sync only ever backfilled the on-screen FY
--
-- Idempotent: sync_tds_filings_for_service only inserts rows that don't
-- already exist and never resets existing statuses.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cs.id
    FROM client_services cs
    JOIN service_categories sc ON sc.id = cs.service_category_id
    JOIN clients c             ON c.id  = cs.client_id
    WHERE sc.linked_module = 'tds'
      AND cs.is_active = true
      AND c.is_draft = false
      AND c.deleted_at IS NULL
  LOOP
    PERFORM public.sync_tds_filings_for_service(r.id);
  END LOOP;
END $$;
