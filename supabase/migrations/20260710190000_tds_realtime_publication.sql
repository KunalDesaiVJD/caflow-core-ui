-- Enable Supabase Realtime for the TDS single-source-of-truth tables so the
-- whole TDS module updates live the instant a client's TDS Compliance
-- changes — no navigation or manual refresh needed. The frontend subscribes
-- to postgres_changes on these tables (RLS scopes each firm to its own rows).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'client_services'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.client_services;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tds_filings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tds_filings;
  END IF;
END $$;
