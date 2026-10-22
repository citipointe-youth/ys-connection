// Connection Audit fed by the console (spec 2026-10-22 §8, §9): the per-source store, its SQL, migration 0043.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CATEGORIES } from '../repositories/interfaces/error-log.repository';

const ROOT = join(__dirname, '..', '..');

describe('migration 0043', () => {
  const m = readFileSync(join(ROOT, 'supabase', 'migrations', '0043_connection_audit_sources.sql'), 'utf8');
  it('adds connection_audit_sources with RLS, a safety copy of connection_audits, and the audit category; additive only', () => {
    expect(m).toMatch(/create table if not exists connection_audits_bak_0043 as select \* from connection_audits;/);
    expect(m).toMatch(/alter table connection_audits_bak_0043 enable row level security;/);
    expect(m).toMatch(/create table if not exists connection_audit_sources \(/);
    expect(m).toMatch(/year int not null check \(year between 2000 and 2100\)/);
    expect(m).toMatch(/source text not null check \(source in \('service','group','team','connect','decision'\)\)/);
    expect(m).toMatch(/fed_by text check \(fed_by in \('console','manual'\)\)/);
    expect(m).toMatch(/last_fail_reason text check \(last_fail_reason in \('read','timeout','budget','empty','shape'\)\)/);
    expect(m).toMatch(/primary key \(year, source\)/);
    expect(m).toMatch(/alter table connection_audit_sources enable row level security;/);
    expect(m).toMatch(/alter table error_log drop constraint if exists error_log_category_check;/);
    expect(m).toMatch(/check \(category in \('server','link','elvanto-form','client','reconcile','audit'\)\)/);
    expect(m).not.toMatch(/(drop table|drop column|alter column|rename)/i);
  });
  it('ERROR_CATEGORIES matches the widened CHECK', () => {
    expect([...ERROR_CATEGORIES]).toEqual(['server', 'link', 'elvanto-form', 'client', 'reconcile', 'audit']);
  });
});
