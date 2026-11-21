-- Consent automation (2026-11-21): the console's Fri 19:45 / Fri 06:30 admin prompts. One row per (kind, date), inserted BEFORE
-- the pushes go out (at-most-once, like alert_sends); one claim covers every recipient. Additive.
create table if not exists prompt_sends (
  kind text not null check (kind in ('consentText', 'consentRecord')),
  key  text not null,                 -- the plan date 'YYYY-MM-DD'
  sent_at timestamptz not null default now(),
  primary key (kind, key)
);
alter table prompt_sends enable row level security;
