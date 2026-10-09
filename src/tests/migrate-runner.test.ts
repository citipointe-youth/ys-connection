import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, listMigrationFiles, shouldRun, MigrationAbort, type MigrationDb, type MigrationFile } from '../migrate/runner';

function fakeDb(opts: { tables?: string[]; applied?: string[]; failOn?: string } = {}) {
  const applied = new Set(opts.applied ?? []);
  const ran: string[] = [];
  const tableChecks: string[] = [];
  let locked = false;
  const db: MigrationDb = {
    async lock() { locked = true; },
    async unlock() { locked = false; },
    async ensureTable() {},
    async appliedVersions() { return [...applied]; },
    async tableExists(name) { tableChecks.push(name); return (opts.tables ?? []).includes(name); },
    async markApplied(versions) { versions.forEach((v) => applied.add(v)); },
    async apply(file) {
      if (file.version === opts.failOn) throw new Error('relation "x" does not exist');
      ran.push(file.version); applied.add(file.version);
    },
    async close() {},
  };
  return { db, ran, applied, tableChecks, isLocked: () => locked };
}
const files = (...v: string[]): MigrationFile[] => v.map((x) => ({ version: x, name: `${x}_x.sql`, path: `/m/${x}_x.sql` }));
const all = files('0001', '0002', '0013', '0014', '0015');

describe('shouldRun', () => {
  it('runs on a production supabase build', () => {
    expect(shouldRun({ VERCEL_ENV: 'production', PERSISTENCE: 'supabase' }, [])).toBe('run');
  });
  it('skips preview builds and memory mode', () => {
    expect(shouldRun({ VERCEL_ENV: 'preview', PERSISTENCE: 'supabase' }, [])).toBe('skip');
    expect(shouldRun({ VERCEL_ENV: 'production', PERSISTENCE: 'memory' }, [])).toBe('skip');
    expect(shouldRun({}, [])).toBe('skip');
  });
  it('runs locally with --force', () => {
    expect(shouldRun({}, ['--force'])).toBe('run');
  });
});

describe('runMigrations', () => {
  it('fresh database: applies every file in order', async () => {
    const f = fakeDb();
    const s = await runMigrations(f.db, all, () => {});
    expect(f.ran).toEqual(['0001', '0002', '0013', '0014', '0015']);
    expect(s).toMatchObject({ total: 5, applied: 5, newCount: 5, baselined: 0 });
  });
  it('checks public-schema tables only (a new Supabase project has auth.users)', async () => {
    const f = fakeDb({ tables: ['auth.users'] });
    await runMigrations(f.db, all, () => {});
    expect(f.tableChecks).toEqual(['public.users', 'public.bus_run_edits']);
    expect(f.ran).toHaveLength(5);
  });
  it('baselines <= 0014 when users + bus_run_edits exist and the table is empty', async () => {
    const f = fakeDb({ tables: ['public.users', 'public.bus_run_edits'] });
    const lines: string[] = [];
    const s = await runMigrations(f.db, all, (l) => lines.push(l));
    expect(f.ran).toEqual(['0015']);
    expect(s).toMatchObject({ total: 5, applied: 5, newCount: 1, baselined: 4 });
    expect(lines.at(-1)).toBe('Database up to date — 5 of 5 changes applied (1 new).');
  });
  it('part-built database (users but no bus_run_edits) aborts', async () => {
    const f = fakeDb({ tables: ['public.users'] });
    await expect(runMigrations(f.db, all, () => {})).rejects.toThrow(MigrationAbort);
    await expect(runMigrations(fakeDb({ tables: ['public.users'] }).db, all, () => {}))
      .rejects.toThrow('Database is part set up; contact the developer');
    expect(f.ran).toEqual([]);
  });
  it('does not baseline when schema_migrations already has rows', async () => {
    const f = fakeDb({ tables: ['public.users', 'public.bus_run_edits'], applied: ['0001', '0002', '0013', '0014'] });
    await runMigrations(f.db, all, () => {});
    expect(f.ran).toEqual(['0015']);
  });
  it('stops on the first failure and names the file', async () => {
    const f = fakeDb({ failOn: '0002' });
    await expect(runMigrations(f.db, all, () => {})).rejects.toThrow(/0002_x\.sql.*relation "x" does not exist/);
    expect(f.ran).toEqual(['0001']);
    expect(f.isLocked()).toBe(false); // unlocked even on failure
  });
  it('ignores table versions with no file (old code rolled back)', async () => {
    const f = fakeDb({ applied: ['0001', '0002', '0013', '0014', '0015', '0016'] });
    const s = await runMigrations(f.db, all, () => {});
    expect(f.ran).toEqual([]);
    expect(s).toMatchObject({ total: 5, applied: 5, newCount: 0 });
  });
});

describe('listMigrationFiles', () => {
  it('lists NNNN_*.sql sorted by filename, ignoring other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const n of ['0010_b.sql', '0002_a.sql', 'README.md', 'x.sql']) writeFileSync(join(dir, n), '--');
    expect(listMigrationFiles(dir).map((f) => f.version)).toEqual(['0002', '0010']);
  });
});
