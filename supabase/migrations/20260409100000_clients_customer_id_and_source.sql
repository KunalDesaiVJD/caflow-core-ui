-- ─────────────────────────────────────────────────────────────────────────────
-- Add customer_id and source columns to clients table
--
-- customer_id : external identifier from eofficeportal API (Tally GUID, etc.)
--               Used for deduplication during API sync.
-- source      : how the client was created — 'manual' | 'api_import'
--               Used by the "Clients via API" tab filter.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS customer_id  TEXT,
  ADD COLUMN IF NOT EXISTS source       TEXT NOT NULL DEFAULT 'manual';

-- Backfill: all existing clients were created manually
UPDATE public.clients
  SET source = 'manual'
  WHERE source IS NULL;

-- Unique partial index: one customer_id per firm, NULLs excluded
-- (customers from different firms may share the same eofficeportal ID)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_customer_id_firm
  ON public.clients (customer_id, firm_id)
  WHERE customer_id IS NOT NULL AND deleted_at IS NULL;

-- Fast lookup by customer_id alone (for dedup queries)
CREATE INDEX IF NOT EXISTS idx_clients_customer_id
  ON public.clients (customer_id)
  WHERE customer_id IS NOT NULL;

-- Fast lookup for "Clients via API" tab
CREATE INDEX IF NOT EXISTS idx_clients_source
  ON public.clients (source, firm_id)
  WHERE deleted_at IS NULL;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
