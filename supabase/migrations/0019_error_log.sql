-- Migration 0019: admin Error log (UX batch 2026-10-13 T3).
-- Additive only: one new table. One row per fingerprint (category + code + route + status); repeats bump count.
-- Never holds a name, phone, request body or value: code, route, status, role and a short fixed message only.
create table if not exists error_log (
  id text primary key,                          -- sha256(fingerprint), first 32 hex chars
  category text not null check (category in ('server', 'link', 'elvanto-form', 'client')),
  code text not null,
  route text not null,
  status int,
  message text not null,                        -- fixed text chosen by the server, never a raw error message
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_role text,
  minimised boolean not null default false,
  ignored boolean not null default false
);
create index if not exists error_log_last_seen_idx on error_log(last_seen);
alter table error_log enable row level security;
