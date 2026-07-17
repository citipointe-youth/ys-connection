create table if not exists prayer_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  text text not null,
  status text not null default 'open',        -- 'open' | 'answered' | 'archived'
  answer_note text,
  created_by_label text not null default '',
  created_by_role text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  answered_at timestamptz
);
create index if not exists prayer_requests_student_idx on prayer_requests(student_id);
create index if not exists prayer_requests_status_idx  on prayer_requests(status);

-- Same posture as every other table (see 0002_rls.sql): the app connects as
-- the postgres superuser and bypasses RLS; enabling it here is defence-in-depth
-- against a leaked anon key, with no policies needed.
alter table prayer_requests enable row level security;
