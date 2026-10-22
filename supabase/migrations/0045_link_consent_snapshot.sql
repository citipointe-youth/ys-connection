-- Migration 0045: consent hub (2026-10-23, LINK_REV 19). Additive. The console's standing copy of each consent list (one row per
-- kind, replaced whole by a newer push), rows ENCRYPTED (AAD link_consent_snapshot.rows:<kind>), and the admin's last Refresh ask.
create table if not exists link_consent_snapshot (
  kind text primary key check (kind in ('forms','mismatches','unlinked','other')),
  total int,                                 -- null = unknown (a cut list)
  rows text not null,
  taken_at timestamptz not null,
  console_id uuid not null,
  applied_at timestamptz not null default now()
);
alter table link_consent_snapshot enable row level security;
create table if not exists link_consent_snap_ask (id int primary key default 1 check (id = 1), asked_at timestamptz not null);
alter table link_consent_snap_ask enable row level security;
