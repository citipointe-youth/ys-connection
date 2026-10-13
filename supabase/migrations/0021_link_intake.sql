-- Migration 0021: Elvanto link, youth intake + consents in the app (UX batch 2026-10-13 T4; contract X19).
-- Additive. RLS on every new table (the API is the superuser; RLS blocks the anon key). No FK (Full Reset never touches these).
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText'));
alter table link_outbox add column if not exists steps jsonb;   -- X19 result steps[] (keys + outcomes); intake rows only
alter table link_outbox add column if not exists stop jsonb;    -- X19 result stop {code, text}

create table if not exists link_intake_dates (
  mode text not null check (mode in ('intake','consent')),
  date date not null,                        -- the plan's Friday
  taken_at timestamptz,                      -- the console's read start (ordering); null = asked, not pushed yet
  console_id uuid,
  row_count int not null default 0,
  cut boolean not null default false,        -- a form list was cut; every row is needs-you
  inputs_from text check (inputs_from in ('console','app')),
  inputs_at timestamptz,
  refresh_asked_at timestamptz,              -- the admin pressed Refresh; cleared when a push for it lands
  applied_at timestamptz not null default now(),
  primary key (mode, date)
);
alter table link_intake_dates enable row level security;

create table if not exists link_intake_rows (
  mode text not null check (mode in ('intake','consent')),
  date date not null,
  key uuid not null,                         -- student form id / parent form id / student person id
  status text not null check (status in ('needs-you','ready','done')),
  title text not null,                       -- the name shown in the list
  reason text not null default '',           -- holds[0].text
  outcome text not null default '',          -- consent rows: the planned outcome (for the list chip)
  from_app boolean not null default false,
  has_text boolean not null default false,   -- a todo complete:parent step is in the plan
  detail text,                               -- ENCRYPTED JSON of the whole pushed row; null once done
  taken_at timestamptz not null,
  done_at timestamptz,
  primary key (mode, date, key)
);
alter table link_intake_rows enable row level security;
create index if not exists link_intake_rows_date on link_intake_rows (date);

create table if not exists link_intake_view (id int primary key default 1 check (id = 1), viewed_at timestamptz); -- hurry hint
alter table link_intake_view enable row level security;
