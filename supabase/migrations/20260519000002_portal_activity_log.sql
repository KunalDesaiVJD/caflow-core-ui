-- Portal activity log: tracks client portal actions (query replies, document uploads).
-- Used by send-notification to send a smart-batched digest to info@vjdesai.com
-- (at most once every 4 hours) instead of one email per activity.

CREATE TABLE IF NOT EXISTS public.portal_activity_log (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id     UUID        NOT NULL,
  client_id   UUID,
  client_name TEXT,
  activity    TEXT        NOT NULL,  -- 'query_reply' | 'document_upload'
  details     TEXT,
  notified    BOOLEAN     DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_activity_log_firm_notified
  ON public.portal_activity_log (firm_id, notified, created_at DESC);

-- RLS: no direct access; edge functions access via service role (bypasses RLS)
ALTER TABLE public.portal_activity_log ENABLE ROW LEVEL SECURITY;
