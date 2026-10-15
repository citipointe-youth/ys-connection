-- Migration 0027: Elvanto link REV 6 (run 2026-10-15, lane A; ux-run-2026-10-15/CONTRACT-REV6.md).
-- Additive. R1: the profile consent flag on roster + flow rows (null = unknown / an older console).
-- R4 + R2: three new outbox types. R2 b/c: one consentLookup answer per request (rows encrypted, purged after 24 h).
alter table link_roster add column if not exists consent text check (consent in ('ok','contact','all','unknown'));
alter table link_flow_people add column if not exists consent text check (consent in ('ok','contact','all','unknown'));

alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText',
  'removeFromFlowStep','consentLookup','consentFix'));

create table if not exists link_consent_lookup (
  request_id uuid primary key,              -- the consentLookup outbox row's id
  kind text not null check (kind in ('forms','mismatches')),
  page int not null,
  page_size int not null,
  total int,                                -- null = unknown
  rows text not null,                       -- ENCRYPTED JSON array (names, consent dates); AAD link_consent_lookup.rows:<request_id>
  taken_at timestamptz not null,
  console_id uuid not null,
  created_at timestamptz not null default now()
);
alter table link_consent_lookup enable row level security;
create index if not exists link_consent_lookup_created on link_consent_lookup (created_at);
