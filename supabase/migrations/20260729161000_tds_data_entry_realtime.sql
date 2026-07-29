-- ═══════════════════════════════════════════════════════════════════════════
-- Live Data Entry → Client Portal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260710190000_tds_realtime_publication.sql put client_services and
-- tds_filings on the supabase_realtime publication, which is enough for the
-- staff-side TDS module (it reacts to compliance + filing-level changes).
--
-- The portal's read-only Data Entry view shows CHALLAN and DEDUCTEE rows, and
-- those live in tds_challans / tds_deductees — neither of which is published.
-- Without this, a deductee edited by staff would not reach an open portal tab
-- until the poll/refocus fallback fired.
--
-- REPLICA IDENTITY FULL for the same reason spelled out in
-- 20260710200000_tds_realtime_replica_identity.sql: with the default (PK only)
-- an UPDATE/DELETE event carries just the id in its "old" record, so Realtime
-- cannot evaluate RLS — which keys off client_id/firm_id — against the old row
-- and silently drops the event for authenticated subscribers.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tds_challans', 'tds_deductees'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.tds_challans  REPLICA IDENTITY FULL;
ALTER TABLE public.tds_deductees REPLICA IDENTITY FULL;
