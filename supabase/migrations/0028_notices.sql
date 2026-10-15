-- Notices: admin/director messages addressed to any subset of the four quad logins (b79, g79, b1012, g1012).
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  recipients text[] not null,
  sender_id text not null,
  sender_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists notices_created_at_idx on notices(created_at desc);
-- Same posture as every other table (0002_rls.sql): app connects as superuser; RLS is defence-in-depth.
alter table notices enable row level security;
