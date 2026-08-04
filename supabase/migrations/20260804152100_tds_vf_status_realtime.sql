-- ═══════════════════════════════════════════════════════════════════════════
-- Live "Ready / Not-ready" badge on the Filings Dashboard
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TdsFilingsManager's "Ready" column (fetchVfStatuses, src/components/tds/
-- TdsFilingsManager.tsx) is computed from tds_recon_results (Stage 1),
-- tds_pan_verification_results (Stage 2), tds_tally_results (Stage 3), and
-- tds_filing_audit_log (the checker's digital-signature action). None of
-- these four tables were on the supabase_realtime publication — only
-- client_services and tds_filings were (20260710190000). A comment in
-- TdsFilings.tsx's manual-sync button already claims "the module already
-- updates live via Realtime" for this badge, which was not true for these
-- four tables: completing Stage 1-3 or signing in Validate & Finalise left
-- the Dashboard's badge stale until the 45s poll fired or the user clicked
-- the Dashboard tab (which does force a refetch) — read as "the dashboard
-- still says Stage 1 pending when Validate & Finalise shows everything OK".
--
-- REPLICA IDENTITY FULL for the same reason as every other realtime TDS
-- table (20260710200000, 20260729161000): without it, an UPDATE/DELETE event
-- carries only the row id in its "old" record, so Realtime cannot evaluate
-- RLS (which keys off filing_id/firm_id) against the old row and silently
-- drops the event for authenticated subscribers.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tds_recon_results',
    'tds_pan_verification_results',
    'tds_tally_results',
    'tds_filing_audit_log'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;
END $$;
