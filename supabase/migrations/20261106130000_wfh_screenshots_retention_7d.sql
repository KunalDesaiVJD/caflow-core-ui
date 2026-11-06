-- 7-day retention for employee screenshots on the server.
--
-- A daily pg_cron job deletes both the stored image objects and their metadata
-- rows once they are older than 7 days. The laptop agent purges its own local
-- copies on the same 7-day window (config.yaml retention_days), so nothing older
-- than a week survives on either side.
--
-- SAFETY: idempotent — re-running re-creates the same single scheduled job.

create extension if not exists pg_cron;

-- Remove any prior copy of this job so re-applying doesn't duplicate it.
do $$
begin
  perform cron.unschedule('masterflow_ss_retention_7d');
exception when others then
  null;  -- not scheduled yet
end $$;

-- Daily at 01:15 UTC: drop old storage objects first, then old metadata rows.
select cron.schedule(
  'masterflow_ss_retention_7d',
  '15 1 * * *',
  $job$
    delete from storage.objects
      where bucket_id = 'employee-screenshots'
        and created_at < now() - interval '7 days';
    delete from public.employee_screenshots
      where captured_at < now() - interval '7 days';
  $job$
);
