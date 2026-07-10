-- Make Supabase Realtime robust in production. With the default REPLICA
-- IDENTITY (primary key only), UPDATE/DELETE change events carry only the id
-- in their "old" record, so Realtime cannot evaluate RLS (which keys off
-- firm_id) against the old row and may DROP the event for authenticated
-- subscribers. REPLICA IDENTITY FULL puts every column in the old record so
-- RLS can authorize the event and the TDS module reliably receives live
-- updates when a client's TDS Compliance (or a filing) changes.

ALTER TABLE public.client_services REPLICA IDENTITY FULL;
ALTER TABLE public.tds_filings REPLICA IDENTITY FULL;
