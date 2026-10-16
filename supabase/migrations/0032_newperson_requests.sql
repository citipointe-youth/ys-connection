-- Migration 0032: nav/save fix round 2026-10-16 (S-5/D4). Additive only: one new table.
-- One row per New person request id (a client UUID made when the host taps Send, reused on every resend).
-- A second send with the same id (a lost reply, a double tap on another serverless instance, a resend after
-- the app was closed) is answered from `result` instead of posting the student to Elvanto again.
-- `result` holds outcomes and the submission ref only, never the person. The app purges rows 14 days after created_at.
create table if not exists newperson_requests (
  id text primary key,
  created_by text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists newperson_requests_created_idx on newperson_requests(created_at);
alter table newperson_requests enable row level security;
