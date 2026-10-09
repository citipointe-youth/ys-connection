-- Bus history (spec 2026-10-09-bus-past-history): who drove survives leader deletion, removed riders
-- stay as "not riding", no-show + note + was-guest on rider rows, and a log of past-night edits.
-- Additive only.
alter table bus_run_vehicles add column if not exists leader_snap jsonb not null default '[]';  -- [{id,name,gender}]
-- Backfill from the live leaders (a since-deleted leader can't be recovered; they simply drop out).
update bus_run_vehicles v set leader_snap = coalesce((
  select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name, 'gender', l.gender))
  from leaders l where v.leader_ids @> to_jsonb(l.id::text)
), '[]'::jsonb)
where v.leader_snap = '[]'::jsonb and v.leader_ids <> '[]'::jsonb;

alter table bus_run_riders add column if not exists not_riding boolean not null default false;
alter table bus_run_riders add column if not exists no_show boolean not null default false;
alter table bus_run_riders add column if not exists note text;                                    -- encrypted
alter table bus_run_riders add column if not exists was_guest boolean not null default false;

create table if not exists bus_run_edits (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references bus_runs(id) on delete cascade,
  at timestamptz not null default now(),
  by text not null,
  detail text not null        -- encrypted
);
create index if not exists bus_run_edits_run_idx on bus_run_edits(run_id);
alter table bus_run_edits enable row level security;
