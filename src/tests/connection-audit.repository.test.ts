// Connection Audit fed by the console (spec 2026-10-22 §8, §9): the per-source store, its SQL, migration 0043.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CATEGORIES } from '../repositories/interfaces/error-log.repository';
import { InMemoryConnectionAuditRepository } from '../repositories/in-memory';
import type { StoredAuditSource } from '../core/entities/connection-audit';

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

const src = readFileSync(join(ROOT, 'src', 'repositories', 'supabase', 'supabase.connection-audit.ts'), 'utf8');
/** One method's source, from `async name(` or `async name<` to the next method. */
function method(name: string): string {
  const start = src.search(new RegExp(`\\n  async ${name}[<(]`));
  if (start < 0) throw new Error(`no method ${name}`);
  const next = src.slice(start + 2).search(/\n  (async )?[a-zA-Z_]+[<(]/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 2 + next);
}
const flat = (s: string) => s.replace(/\s+/g, ' ');
const row = (o: Partial<StoredAuditSource> = {}): StoredAuditSource => ({ year: 2026, source: 'service',
  headers: ['First Name', 'Last Name', 'Fri 06/02'], rows: [['Alex', 'Sample', 'Y']], rowCount: 1,
  takenAt: '2026-10-23T11:00:00.000Z', exportedAt: '2026-10-23T11:00:00.000Z', fedAt: '2026-10-23T11:05:00.000Z', fedBy: 'console',
  lastFailedAt: null, lastFailReason: null, ...o });
const audit = (year: number, keys: string[]) => ({ id: String(year), year, label: String(year), uploadedBy: 'console',
  uploadedAt: `${year}-10-23T11:05:00.000Z`, snapshot: { terms: keys.map((key) => ({ key })) } as never });

describe('InMemoryConnectionAuditRepository: per-source copies', () => {
  it('saveSource upserts one copy per (year, source); sources(year) returns that year only, as copies', async () => {
    const r = new InMemoryConnectionAuditRepository(); await r.init();
    await r.saveSource(row());
    await r.saveSource(row({ rows: [['Jamie', 'Test', 'Y']] }));
    await r.saveSource(row({ source: 'group' }));
    await r.saveSource(row({ year: 2025 }));
    const s = await r.sources(2026);
    expect(s.map((x) => x.source).sort()).toEqual(['group', 'service']);
    expect(s.find((x) => x.source === 'service')!.rows).toEqual([['Jamie', 'Test', 'Y']]);
    s.find((x) => x.source === 'service')!.rows.push(['mutated']);
    expect((await r.sources(2026)).find((x) => x.source === 'service')!.rows).toHaveLength(1);
  });
  it('deleteAllSources empties every year; init() clears them too', async () => {
    const r = new InMemoryConnectionAuditRepository(); await r.init();
    await r.saveSource(row()); await r.saveSource(row({ year: 2025 }));
    await r.deleteAllSources();
    expect([...(await r.sources(2026)), ...(await r.sources(2025))]).toEqual([]);
    await r.saveSource(row()); await r.init();
    expect(await r.sources(2026)).toEqual([]);
  });
  it('findAllSummaries: newest year first, term keys only, no snapshot', async () => {
    const r = new InMemoryConnectionAuditRepository(); await r.init();
    await r.save(audit(2025, []));
    await r.save(audit(2026, ['2026-T1', '2026-T2']));
    expect(await r.findAllSummaries()).toEqual([
      { year: 2026, label: '2026', uploadedAt: '2026-10-23T11:05:00.000Z', termKeys: ['2026-T1', '2026-T2'] },
      { year: 2025, label: '2025', uploadedAt: '2025-10-23T11:05:00.000Z', termKeys: [] },
    ]);
  });
  it('withYearLock hands fn a repository and returns its result', async () => {
    const r = new InMemoryConnectionAuditRepository(); await r.init();
    const out = await r.withYearLock(2026, async (tx) => { await tx.saveSource(row()); return 'done'; });
    expect(out).toBe('done');
    expect(await r.sources(2026)).toHaveLength(1);
  });
});

describe('SupabaseConnectionAuditRepository SQL text', () => {
  it('withYearLock: ONE transaction under the per-year advisory lock, fn bound to tx', () => {
    const c = flat(method('withYearLock'));
    expect(c).toContain('this.sql.begin(');
    expect(c).toContain("pg_advisory_xact_lock(hashtext(${'audit:' + year}))");
    expect(c).toContain('new SupabaseConnectionAuditRepository(tx as unknown as SqlClient)');
  });
  it('findAllSummaries reads the term keys with jsonb_path_query_array, never select * or the snapshot', () => {
    const c = flat(method('findAllSummaries'));
    expect(c).toContain("select year, label, uploaded_at, jsonb_path_query_array(snapshot, '$.terms[*].key') as term_keys from connection_audits order by year desc");
    expect(c).not.toContain('select *');
  });
  it('saveSource upserts on (year, source) and writes jsonb through sql.json', () => {
    const c = flat(method('saveSource'));
    expect(c).toContain('insert into connection_audit_sources');
    expect(c).toContain('on conflict (year, source) do update set');
    expect(c).toContain('this.sql.json(');
  });
  it('sources reads one year; deleteAllSources deletes every row', () => {
    expect(flat(method('sources'))).toContain('from connection_audit_sources where year = ${year}');
    expect(flat(method('deleteAllSources'))).toContain('delete from connection_audit_sources');
  });
});
