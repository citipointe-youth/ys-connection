-- Migration 0018: Elvanto link UX batch (spec docs/superpowers/specs/2026-10-12-ux-batch.md T1, T4, T6, T8).
-- Additive only: new nullable/defaulted columns and one new table. Nothing the live code reads changes meaning.

-- T1: the console's LINK_REV from its last claim (missing = 1).
alter table link_console add column if not exists link_rev int not null default 1;

-- T8: up to 8 past reports per group, newest first (same shape as last_report); never notes.
alter table link_groups add column if not exists history jsonb not null default '[]';

-- T4: the flow person's own grade/gender, and a mobile (their own, else a parent's: mobile_is_parent).
alter table link_flow_people add column if not exists grade int;
alter table link_flow_people add column if not exists gender text;
alter table link_flow_people add column if not exists mobile text;   -- encrypted (field-crypto), AAD link_flow_people.mobile:<row_id>
alter table link_flow_people add column if not exists mobile_is_parent boolean not null default false;

-- T6: a flow person given to a self-identified leader. App only, never sent to Elvanto. Lasts while the person is in
-- that flow: the flows push deletes rows whose (flow, person) it no longer carries. A deleted leader takes theirs along.
create table if not exists link_flow_assign (
  flow_id uuid not null,
  person_id uuid not null,
  leader_id uuid not null references leaders(id) on delete cascade,
  assigned_by text not null,                    -- the login (username) that assigned it
  assigned_at timestamptz not null default now(),
  primary key (flow_id, person_id)
);
alter table link_flow_assign enable row level security;
