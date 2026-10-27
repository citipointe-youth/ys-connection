-- Migration 0051: read-only birthdays view for the operator's Personal Dashboard (2026-10-28, ys/dashboard-birthdays). Additive.
-- Own schema `dashboard` (not in PostgREST's exposed schemas, and every Data API role is revoked below), one view, and a
-- NOLOGIN role `dashboard_reader` that can read only that view. The view runs with its owner's rights (security_invoker
-- off, the default) so students' RLS does not block it: intended, the view exposes only first name, last initial, grade
-- and the birthday's day in the window. Never date of birth/year, mobile, parent phone or the full last name.
-- The operator turns the login on by hand (DEPLOY.md "Dashboard birthdays reader"); the password never lives in the repo.
create schema if not exists dashboard;
revoke all on schema dashboard from public;

-- ponytail: a Feb 29 birthday only shows in leap years; add a Feb 28 fallback if anyone notices.
create or replace view dashboard.upcoming_birthdays as
select s.first_name::text as first_name,
       left(s.last_name, 1)::text as last_initial,
       s.grade::int as grade,
       (t.today + n)::date as birthday,
       n::int as days_away
from (select (now() at time zone 'Australia/Brisbane')::date as today) t
cross join generate_series(0, 6) as n
join public.students s
  on extract(month from s.date_of_birth) = extract(month from t.today + n)
 and extract(day from s.date_of_birth) = extract(day from t.today + n)
where s.gender = 'male'
  and s.date_of_birth is not null
  and s.graduated_at is null;

revoke all on dashboard.upcoming_birthdays from public;

do $$
declare r text;
begin
  if not exists (select 1 from pg_roles where rolname = 'dashboard_reader') then
    create role dashboard_reader nologin;
  end if;
  -- Supabase's Data API roles (absent on a plain Postgres, e.g. CI): no access to the schema or the view.
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema dashboard from %I', r);
      execute format('revoke all on all tables in schema dashboard from %I', r);
      execute format('alter default privileges in schema dashboard revoke all on tables from %I', r);
    end if;
  end loop;
end $$;

grant usage on schema dashboard to dashboard_reader;
grant select on dashboard.upcoming_birthdays to dashboard_reader;
