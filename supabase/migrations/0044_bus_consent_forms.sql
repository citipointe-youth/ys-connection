-- Migration 0044: bus consent via the Elvanto form (LINK_REV 18, spec 2026-10-22 bus consent). Part 1: the outbox type.
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText',
  'removeFromFlowStep','consentLookup','consentFix','consentLink','recheck','busConsentCheck'));

-- Part 2 (Task 3): tables + drop bus_consents
-- The Elvanto bus consent forms the console reads (one row per child) and the app-side audit of in-app submits.
-- R10 clean cut: bus_consents goes (the operator backed it up). Rollback below this build needs it back empty: see DEPLOY.md.
create table if not exists bus_consent_forms (
  id uuid primary key,
  submission_id uuid not null,
  child_index int not null check (child_index between 0 and 9),
  submitted_at timestamptz not null,
  year int not null,
  student_id uuid references students(id) on delete set null,
  guest_id uuid references bus_guests(id) on delete set null,
  first text not null,
  last text not null,
  data text not null,           -- encrypted JSON (BusConsentData), AAD bus_consent_forms:data:<id>
  source text not null default 'public' check (source in ('app','public')),
  created_at timestamptz not null default now(),
  unique (submission_id, child_index)
);
alter table bus_consent_forms enable row level security;
create index if not exists bus_consent_forms_year_idx on bus_consent_forms (year);
create table if not exists bus_consent_submits (
  id uuid primary key,
  student_id uuid references students(id) on delete set null,
  guest_id uuid references bus_guests(id) on delete set null,
  leader_id uuid,
  leader_name text not null default '',
  submitted_at timestamptz not null default now(),
  read_out_confirmed boolean not null default true check (read_out_confirmed),
  elvanto_result text not null check (elvanto_result in ('sent','unconfirmed','failed')),
  name text not null            -- encrypted "first|last" as typed, AAD bus_consent_submits:name:<id>
);
alter table bus_consent_submits enable row level security;
drop table if exists bus_consents;
