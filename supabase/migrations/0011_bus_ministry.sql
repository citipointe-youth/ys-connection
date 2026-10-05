-- Bus Ministry (spec 2026-10-05). History tables deliberately have NO foreign key
-- to students/leaders: Full Reset runs `truncate students/leaders cascade`, which
-- empties every referencing table. Only saved addresses and leader prefs cascade.
create table if not exists bus_vehicles (
  id uuid primary key,
  name text not null,
  plate text,
  seats int not null check (seats between 1 and 60),
  pref_grades jsonb not null default '[]',
  ends_at text not null default 'church',
  ends_address text,          -- encrypted
  ends_place_id text,         -- encrypted
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists bus_leader_prefs (
  leader_id uuid primary key references leaders(id) on delete cascade,
  in_pool boolean not null default false,
  fixed_vehicle_id uuid references bus_vehicles(id) on delete set null,
  own_car jsonb,              -- ends_address/ends_place_id inside are encrypted
  last_own_rider_keys jsonb not null default '[]'
);
create table if not exists bus_guests (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  grade int,
  gender text,
  phone text,                 -- encrypted
  linked_student_id uuid,     -- no FK (survives Full Reset)
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  last_ridden_at timestamptz
);
create table if not exists bus_addresses (
  id uuid primary key,
  student_id uuid references students(id) on delete cascade,
  guest_id uuid references bus_guests(id) on delete cascade,
  label text not null default '',
  address text not null,      -- encrypted
  place_id text,              -- encrypted
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (student_id is not null or guest_id is not null)
);
create index if not exists bus_addresses_student_idx on bus_addresses(student_id);
create index if not exists bus_addresses_guest_idx on bus_addresses(guest_id);
create table if not exists bus_runs (
  id uuid primary key,
  service_date date not null unique,
  version int not null default 0,
  available_pool_leader_ids jsonb not null default '[]',
  lock_by text,
  lock_until timestamptz,
  last_change_by text,
  last_change_at timestamptz,
  undo_snapshot jsonb,
  undo_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists bus_run_vehicles (
  id uuid primary key,
  run_id uuid not null references bus_runs(id) on delete cascade,
  vehicle_id uuid references bus_vehicles(id) on delete set null,
  owner_leader_id uuid,       -- no FK (survives Full Reset)
  name text not null,
  seats int not null,
  plate text,
  running boolean not null default true,
  leader_ids jsonb not null default '[]',
  ends_at text not null default 'church',
  ends_address text,          -- encrypted
  ends_place_id text,         -- encrypted
  colour_index int not null default 0
);
create index if not exists bus_run_vehicles_run_idx on bus_run_vehicles(run_id);
create table if not exists bus_run_riders (
  id uuid primary key,
  run_id uuid not null references bus_runs(id) on delete cascade,
  student_id uuid,            -- no FK (history survives Full Reset)
  guest_id uuid,              -- no FK
  address_id uuid,            -- no FK
  run_vehicle_id uuid references bus_run_vehicles(id) on delete set null,
  stop_order int,
  pinned boolean not null default false,
  added_by text not null default '',
  added_at timestamptz not null default now(),
  snap_name text not null,    -- encrypted
  snap_grade int,
  snap_gender text,
  snap_address text not null, -- encrypted
  snap_place_id text          -- encrypted
);
create index if not exists bus_run_riders_run_idx on bus_run_riders(run_id);
create unique index if not exists bus_run_riders_student_uq on bus_run_riders(run_id, student_id) where student_id is not null;
create unique index if not exists bus_run_riders_guest_uq on bus_run_riders(run_id, guest_id) where guest_id is not null;

alter table bus_vehicles      enable row level security;
alter table bus_leader_prefs  enable row level security;
alter table bus_guests        enable row level security;
alter table bus_addresses     enable row level security;
alter table bus_runs          enable row level security;
alter table bus_run_vehicles  enable row level security;
alter table bus_run_riders    enable row level security;
