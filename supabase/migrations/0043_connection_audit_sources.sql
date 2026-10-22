-- Migration 0043: Connection Audit fed by the console (spec 2026-10-22 §9). Additive. One stored copy per (year, source):
-- the PUSHED cell table (headers + cells), not parsed rows, so a parser fix re-applies on the next build without a re-feed.
-- fed_at null = never had a good copy (a failure-only row has headers = rows = '[]'). Widens the error_log category CHECK
-- (0019/0035) with 'audit'.
create table if not exists connection_audits_bak_0043 as select * from connection_audits;  -- one-time copy before the console overwrites 2026
alter table connection_audits_bak_0043 enable row level security;                           -- it holds per-student rows: same lock-down as the rest
create table if not exists connection_audit_sources (
  year int not null check (year between 2000 and 2100),
  source text not null check (source in ('service','group','team','connect','decision')),
  headers jsonb not null,
  rows jsonb not null,
  row_count int not null,
  taken_at timestamptz not null,
  exported_at timestamptz not null,
  fed_at timestamptz,
  fed_by text check (fed_by in ('console','manual')),
  last_failed_at timestamptz,
  last_fail_reason text check (last_fail_reason in ('read','timeout','budget','empty','shape')),
  primary key (year, source)
);
alter table connection_audit_sources enable row level security;
alter table error_log drop constraint if exists error_log_category_check;
alter table error_log add constraint error_log_category_check
  check (category in ('server','link','elvanto-form','client','reconcile','audit'));
