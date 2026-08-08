-- TDS email automation via pg_cron + pg_net.
--
-- cron.schedule upserts by job name, so re-applying this migration is safe.
-- Auth uses the project's own PUBLISHABLE anon key (the same literal already
-- committed in src/integrations/supabase/client.ts and protected entirely by
-- RLS — not a secret) — matching this project's own existing cron job
-- ('tds-due-alerts', which authenticates send-notification calls the same
-- way). The edge functions themselves use the service role (their own env)
-- to read/write tds_email_outbox.

-- 04:30 UTC (~10:00 IST) daily: queue today's reminder step, if any, for
-- every enabled client whose filing for the matching quarter is still "Not
-- Started". A no-op on every day that isn't one of the 12 scheduled dates.
select cron.schedule('tds-queue-reminders-daily', '30 4 * * *', $cron$
  select net.http_post(
    url := 'https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/queue-tds-reminders',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);

-- Hourly: deliver whatever is pending in the outbox — queued reminders plus a
-- backstop for any filing confirmation whose immediate send failed. Batched at
-- 25/run so each invocation finishes well inside the pg_net timeout.
select cron.schedule('tds-send-outbox-hourly', '0 * * * *', $cron$
  select net.http_post(
    url := 'https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/send-tds-email',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc"}'::jsonb,
    body := '{"limit":25}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
