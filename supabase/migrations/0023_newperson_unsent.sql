-- Migration 0023: New person unsent queue (UX batch 2026-10-14b T10).
-- Additive only: one new table. A New person send that failed, was unconfirmed, or never reached Elvanto is kept
-- here for the admin to resend. `payload` is the submitted form ENCRYPTED with FIELD_ENCRYPTION_KEY
-- (AAD newperson_unsent.payload:<id>); the app purges rows 14 days after created_at.
create table if not exists newperson_unsent (
  id text primary key,
  reason text not null check (reason in ('unreachable', 'form-changed', 'failed', 'unconfirmed')),
  payload text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists newperson_unsent_created_idx on newperson_unsent(created_at);
alter table newperson_unsent enable row level security;
