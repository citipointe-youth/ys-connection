-- Leader phone alerts: the device's "I am" leader + per-phone prefs on the push subscription, and the send ledger.
alter table notice_push_subscriptions
  add column if not exists leader_id uuid references leaders(id) on delete set null,
  add column if not exists bday_on   boolean not null default true,
  add column if not exists lgrem_on  boolean not null default true;

-- One row per (kind, occurrence key, leader); inserted BEFORE that leader's push goes out (at-most-once).
create table if not exists alert_sends (
  kind text not null check (kind in ('bday', 'lgrem')),
  key  text not null,                 -- bday: 'YYYY-MM-DD'; lgrem: '<groupId>:<YYYY-MM-DD>'
  leader_id uuid not null references leaders(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (kind, key, leader_id)
);
alter table alert_sends enable row level security;
