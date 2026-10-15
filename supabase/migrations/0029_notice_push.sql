-- Notice alerts (web push): one row per subscribed device. A new table name on purpose: the retired
-- push_subscriptions table (removed 2026-07-11) may still exist in prod with a different shape.
-- id = sha256(endpoint) prefix, so a re-subscribe from the same device upserts.
create table if not exists notice_push_subscriptions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
-- Same posture as every other table (0002_rls.sql): app connects as superuser; RLS is defence-in-depth.
alter table notice_push_subscriptions enable row level security;
