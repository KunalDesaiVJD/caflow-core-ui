-- Switch 7-day screenshot retention from the in-DB pg_cron job to the GitHub
-- Actions workflow (.github/workflows/wfh-retention.yml).
--
-- Why: a pure SQL delete of storage.objects leaves the underlying image files
-- orphaned in storage (not truly erased). The Actions workflow deletes the real
-- files through the Storage API, then the rows — so old screenshots are removed
-- permanently. Keeping the old pg_cron job as well would race it and re-create
-- orphans, so we unschedule it here.
--
-- SAFETY: idempotent.
do $$
begin
  perform cron.unschedule('masterflow_ss_retention_7d');
exception when others then
  null;  -- already gone
end $$;
