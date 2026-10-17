-- Migration 0036: reconciliation (2026-10-17 spec, Part 2). Additive. lifegroups gets the Elvanto group id (looked up by name at
-- import); lifegroup_roll holds every youth on each group's roll (name keys, no person ids, cleared by the import's truncate cascade);
-- reconcile_runs keeps the newest 20 check runs, ids only, never names.
alter table lifegroups add column if not exists elvanto_group_id uuid;
create table if not exists lifegroup_roll (
  lifegroup_id uuid not null references lifegroups(id) on delete cascade,
  name_key text not null,
  primary key (lifegroup_id, name_key)
);
create table if not exists reconcile_runs (
  id uuid primary key,
  ran_at timestamptz not null,
  import_id text,
  ok boolean not null,
  checks jsonb not null,
  items jsonb not null
);
create index if not exists reconcile_runs_ran_at_idx on reconcile_runs(ran_at desc);
alter table lifegroup_roll enable row level security;
alter table reconcile_runs enable row level security;
