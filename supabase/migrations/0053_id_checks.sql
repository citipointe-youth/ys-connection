-- ID Checks (spec 2026-10-30 §7.1): per-leader catch-up checks and random notes, plus the tick grid.
-- Additive. Deleting a leader keeps its entries (leader_id set null = archived, decision I) and drops its ticks.
create table if not exists id_check_access (           -- the grid: one row per tick
  leader_id uuid not null references leaders(id) on delete cascade,
  user_id   uuid not null references users(id)   on delete cascade,
  created_at timestamptz not null default now(),
  primary key (leader_id, user_id)
);
create table if not exists id_check_entries (          -- checks AND random notes
  id uuid primary key,                                 -- client-made, so autosave is an idempotent upsert
  leader_id uuid references leaders(id) on delete set null,  -- null = leader deleted: archived (decision I)
  leader_name text not null default '',                -- snapshot of the leader's name, refreshed on every save
  kind text not null check (kind in ('check', 'note')),
  held_on date not null,                               -- the catch-up / note date (Brisbane day)
  finished boolean not null default false,             -- decision J; checks only, notes ignore it
  author_id uuid not null,                             -- no FK: entries outlive a deleted account
  author_name text not null default '',
  content text not null,                               -- encrypted JSON envelope (7.2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists id_check_entries_leader_idx on id_check_entries(leader_id, held_on desc);
-- Same posture as every other table (0002_rls.sql): app connects as superuser; RLS is defence-in-depth.
alter table id_check_access enable row level security;
alter table id_check_entries enable row level security;
