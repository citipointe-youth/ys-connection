-- Migration 0042: round 2026-10-22 F1. Additive. Create / Create all on Unmatched claims the Elvanto
-- person first: one row per person a YS student was made from. The primary key makes a second create of the same person a
-- no-op (two admins pressing Create at once). A new, empty table, so students already duplicated in prod can't make this
-- migration fail; nothing is backfilled. student_id is set once the student exists; a failed create deletes its claim.
create table if not exists link_created_students (
  person_id uuid primary key,
  student_id uuid references students(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table link_created_students enable row level security;
