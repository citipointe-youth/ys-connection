-- Parent consent is per person and lasts until revoked (spec §10a). Cascades with the
-- student/guest (a Full Reset therefore clears it, as it does saved addresses).
create table if not exists bus_consents (
  id uuid primary key,
  student_id uuid unique references students(id) on delete cascade,
  guest_id uuid unique references bus_guests(id) on delete cascade,
  given boolean not null default false,
  note text,                  -- encrypted
  recorded_by text not null default '',
  recorded_at timestamptz not null default now(),
  check (student_id is not null or guest_id is not null)
);
alter table bus_consents enable row level security;
alter table bus_run_riders add column if not exists dropped_at timestamptz;
alter table bus_run_riders add column if not exists dropped_by text;
