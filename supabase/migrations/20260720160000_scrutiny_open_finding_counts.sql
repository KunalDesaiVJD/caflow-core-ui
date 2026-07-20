-- Per-engagement open-finding counts for the materiality approval queue.
--
-- The queue ranks engagements by how many open findings are waiting on them, so approving the
-- highest-impact one first. Counting that client-side meant pulling every finding row (14,103 and
-- growing) purely to length-check it. This returns ~110 tiny rows instead.
--
-- security_invoker = true so the caller's own RLS on scrutiny_findings applies: a user sees counts
-- only for their own firm's engagements, exactly as they see the findings themselves. Without it
-- the view would run as its owner and leak counts across firms.

create or replace view scrutiny_open_finding_counts
with (security_invoker = true) as
select
  client_id,
  financial_year,
  count(*)::int as open_count
from scrutiny_findings
where status = 'open'
  and client_id is not null
  and financial_year is not null
group by client_id, financial_year;

comment on view scrutiny_open_finding_counts is
  'Open scrutiny findings per engagement. Firm-scoped through the caller''s RLS on scrutiny_findings (security_invoker).';
