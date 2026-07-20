-- Human judgment register for scrutiny.
--
-- Scrutiny needs decisions the engine cannot derive from the books, and it will need more of them
-- over time: what materiality applies to this engagement, whether a party is an MSME, whether a
-- balance is related-party, which practices this client has an accepted reason for. Rather than add
-- a table per question, every such decision is a row here with a `kind`.
--
-- The contract for every kind is the same:
--   1. the system PROPOSES a value, and records the basis it computed it from
--   2. a human APPROVES or edits it — the proposal never takes effect on its own
--   3. the decision is versioned and attributed, so a later reviewer can see who decided what
--   4. decisions are scoped to one engagement (client + financial year) and re-made each year
--
-- kind = 'materiality' is the first instance. Later kinds need no schema change: only a `kind`
-- value, a proposer, and whatever consumes `decided`.

create table if not exists scrutiny_judgments (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  financial_year  text not null,
  firm_id         uuid,

  kind            text not null,
  -- optional narrowing: the ledger / party / rule a judgment is ABOUT.
  -- null for engagement-wide judgments such as materiality.
  subject         text,

  -- what the system suggested, and the figures it derived it from. Kept even after a human edits
  -- it, so the size of the override is visible on review.
  proposed        jsonb not null default '{}'::jsonb,
  -- what the human actually decided. This is what the engine reads.
  decided         jsonb,

  status          text not null default 'proposed'
                  check (status in ('proposed','approved','rejected','superseded')),
  version         int  not null default 1,

  decided_by      uuid,
  decided_at      timestamptz,
  rationale       text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- At most ONE live judgment per engagement per kind per subject. Superseded/rejected rows stay for
-- history, which is why the constraint is partial rather than a plain unique.
create unique index if not exists scrutiny_judgments_live_uniq
  on scrutiny_judgments (client_id, financial_year, kind, coalesce(subject,''))
  where status in ('proposed','approved');

create index if not exists scrutiny_judgments_lookup
  on scrutiny_judgments (client_id, financial_year, kind, status);

alter table scrutiny_judgments enable row level security;

-- Firm-scoped, mirroring scrutiny_findings exactly: match on firm_id via `users`, with the same
-- superadmin escape. firm_id is backfilled from the client on insert by the trigger below, so a
-- caller cannot place a judgment in another firm by omitting it.
drop policy if exists scrutiny_judgments_firm_rw on scrutiny_judgments;
create policy scrutiny_judgments_firm_rw on scrutiny_judgments
  for all
  using (
    firm_id in (select u.firm_id from users u where u.id = auth.uid())
    or exists (select 1 from users u where u.id = auth.uid() and u.role = 'superadmin')
  )
  with check (
    firm_id in (select u.firm_id from users u where u.id = auth.uid())
    or exists (select 1 from users u where u.id = auth.uid() and u.role = 'superadmin')
  );

-- Keep firm_id authoritative: always derive it from the client rather than trusting the caller.
create or replace function scrutiny_judgments_set_firm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select c.firm_id into new.firm_id from clients c where c.id = new.client_id;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists scrutiny_judgments_firm_trg on scrutiny_judgments;
create trigger scrutiny_judgments_firm_trg
  before insert or update on scrutiny_judgments
  for each row execute function scrutiny_judgments_set_firm();

comment on table scrutiny_judgments is
  'Per-engagement decisions a human must make before scrutiny can be trusted. System proposes, human approves, every version attributed. kind=''materiality'' is the first; new kinds need no schema change.';
comment on column scrutiny_judgments.proposed is
  'System suggestion plus the basis it was computed from (e.g. turnover, total assets, benchmark %). Retained after edit so the override is visible.';
comment on column scrutiny_judgments.decided is
  'The approved values the engine reads. Null until a human decides — a proposal alone never takes effect.';
