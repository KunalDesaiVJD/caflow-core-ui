-- sync_requests: polling table written by the React UI "Sync Now" button,
-- read by the local tally-sync Node agent on each startup.

CREATE TABLE IF NOT EXISTS sync_requests (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id        UUID,
  client_id      UUID,
  engagement_id  UUID,
  status         TEXT        NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  requested_by   UUID,
  requested_at   TIMESTAMPTZ DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sr_engagement ON sync_requests(engagement_id);
CREATE INDEX IF NOT EXISTS idx_sr_status     ON sync_requests(status);

-- RLS: authenticated users can read/insert; service role can update
ALTER TABLE sync_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sync_requests"
  ON sync_requests FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert sync_requests"
  ON sync_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Service role can update sync_requests"
  ON sync_requests FOR UPDATE
  USING (true);
