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

-- Part 3 (Task 6): Brisbane bus form ids
-- Brisbane's bus consent form ids (snapshot 2026-10-22), once, only where 0040 put Brisbane's elvanto block.
update app_settings
   set ministry_config = jsonb_set(jsonb_set(jsonb_set(ministry_config,
         '{elvanto,busConsentFormId}', '"8c9f0929-5b36-4ab7-b9bd-8b4082b013dc"'),
         '{elvanto,fields}', (ministry_config->'elvanto'->'fields') || '{"bcSchool":"submissions[0][people_custom_field][45928c2c-37f0-11e1-9229-ea942707ad51]","bcParentName":"submissions[0][people_custom_field][bab736a4-dbe8-4a0c-ae3e-7c2c5799f9a3]","bcParentPhone":"submissions[0][people_custom_field][c184c020-76ce-11e5-9d36-06ba798128be]","bcPickup":"submissions[0][forms_custom_field][38bb8bd8-af2c-4d1b-b9f0-dd897f046f75]","bcPickupBy":"submissions[0][forms_custom_field][0c29465a-f3f2-4a91-b8c5-c3501fcad697]"}'::jsonb),
         '{elvanto,options}', (ministry_config->'elvanto'->'options') || '{"bcPickupYes":"414b4a65-e135-4b54-9325-6fd99e86b101","bcPickupNo":"840ad9f3-7775-4c01-a6e7-00238a8b5233","bcGrade6":"807c9c80-3825-11e1-9229-ea942707ad51","bcGrade7":"807cac70-3825-11e1-9229-ea942707ad51","bcGrade8":"807cbbb6-3825-11e1-9229-ea942707ad51","bcGrade9":"807ccf48-3825-11e1-9229-ea942707ad51","bcGrade10":"807ce56e-3825-11e1-9229-ea942707ad51","bcGrade11":"807cfbf8-3825-11e1-9229-ea942707ad51","bcGrade12":"807d108e-3825-11e1-9229-ea942707ad51"}'::jsonb)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object'
   and ministry_config->'elvanto'->>'baseUrl' = 'https://citipointe.elvanto.com.au'
   and coalesce(ministry_config->'elvanto'->>'busConsentFormId', '') = '';
