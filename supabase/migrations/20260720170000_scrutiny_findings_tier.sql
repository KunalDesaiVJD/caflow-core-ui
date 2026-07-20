-- Two-tier output: which findings go to the client, and which stay as review notes.
--
-- The engine produces ~95 findings per engagement against the 18.5 queries a human auditor raises,
-- and every one currently lands in the same list — which is why not a single finding has ever been
-- dispositioned. runDetection now tiers them: a capped, ranked shortlist ('query') and the
-- remainder ('note'), which stay searchable and promotable but are never auto-raised.
--
-- Defaults to 'query' so anything written by an older code path keeps its current visibility
-- rather than silently disappearing from the auditor's list.
alter table scrutiny_findings
  add column if not exists tier text not null default 'query'
  check (tier in ('query','note'));

create index if not exists scrutiny_findings_tier_idx
  on scrutiny_findings (client_id, financial_year, tier);

comment on column scrutiny_findings.tier is
  'query = on the capped ranked shortlist an auditor is expected to act on; note = kept, searchable and promotable, never auto-raised.';
