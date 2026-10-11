-- DRAFT (step 0 of spec 2026-10-11-elvanto-link-contract). NOT in supabase/migrations/, so no build applies it.
-- The YS stream's first feature commit moves it there under the next free number and bumps LATEST_MIGRATION.
-- Additive only. No FK to students/leaders/users/service tables: Full Reset and the weekly import must never
-- touch these rows (Bus pattern, 0011). RLS on every table (the API is the superuser; RLS blocks the anon key).
create table if not exists link_outbox (
  id uuid primary key,                         -- made on the phone: the idempotency key
  type text not null check (type in ('checkIn','checkOut','submitReport','editReport','completeStep','firstTimerCheckIn')),
  payload jsonb not null,                      -- ids + small values only; write via sql.json()
  note text,                                   -- encrypted (field-crypto); leader note
  dedupe_key text not null,
  service_date date not null,                  -- Brisbane date (server clock)
  student_id uuid,                             -- no FK
  person_id uuid,                              -- Elvanto person; set by the console for firstTimerCheckIn
  created_by uuid not null,                    -- users.id, no FK
  leader_id uuid,                              -- self-identified, unverified, no FK
  leader_name text not null,                   -- snapshot
  status text not null default 'pending'
    check (status in ('pending','claimed','sent','refused','unclear','shadowed','cancelled')),
  reason text,                                 -- stable code (spec 5.4); 'already' on a sent row
  detail text,                                 -- the console's PII-free sentence
  attempts int not null default 0,
  retry_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  result_at timestamptz,
  sent_log_key text,                           -- 11.1 sent-log key (shadow: the key it would use)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists link_outbox_open_uq on link_outbox(dedupe_key)
  where status in ('pending','claimed','unclear');
create index if not exists link_outbox_queue_idx on link_outbox(created_at) where status in ('pending','claimed');
create index if not exists link_outbox_date_idx on link_outbox(service_date);

create table if not exists link_roster (
  person_id uuid primary key,
  first_name text not null,
  last_name text not null,
  gender text,
  grade int,
  kind text not null default 'other' check (kind in ('student','leader','other')),
  active boolean not null default true,
  student_id uuid,
  match text not null default 'none' check (match in ('auto','manual','none','ambiguous','ignored')),
  updated_at timestamptz not null default now()
);
create unique index if not exists link_roster_student_uq on link_roster(student_id) where student_id is not null;

create table if not exists link_services (
  service_time_id uuid primary key,
  service_id uuid not null,
  name text not null,
  starts_at timestamptz not null,
  ymd date not null,
  rooms jsonb not null default '[]',           -- [{id,name}]
  checked_in jsonb not null default '[]'       -- [{personId,roomId}]
);

create table if not exists link_groups (
  group_id uuid primary key,
  name text not null,
  grade int,                                   -- derived by the app from the name (parseGroupName)
  gender text,                                 -- derived by the app from the name (parseGroupName)
  meets text not null default '',
  members jsonb not null default '[]',         -- [{personId,name,leader}]
  this_week text not null default 'none',
  last_report jsonb                            -- spec 3.4; never notes
);

create table if not exists link_flow_people (
  row_id uuid primary key,
  flow_id uuid not null,
  flow_name text not null,
  step_id uuid not null,
  step_name text not null,
  step_order int not null default 0,
  person_id uuid,
  name text not null,
  due date,
  assigned_to text not null default ''
);

create table if not exists link_console (
  console_id text primary key,
  label text not null default '',
  last_seen_at timestamptz not null default now(),
  contract_version int not null,
  console_version text not null default '',
  in_window boolean not null default false,
  poll_seconds int not null default 900,
  capabilities jsonb not null default '{}'     -- {type: 'live'|'shadow'|'locked'|'off'}
);

create table if not exists link_mirror_state (
  kind text primary key check (kind in ('roster','services','groups','flows')),
  taken_at timestamptz not null,
  console_id text not null,
  row_count int not null default 0,
  applied_at timestamptz not null default now()
);

alter table link_outbox       enable row level security;
alter table link_roster       enable row level security;
alter table link_services     enable row level security;
alter table link_groups       enable row level security;
alter table link_flow_people  enable row level security;
alter table link_console      enable row level security;
alter table link_mirror_state enable row level security;
