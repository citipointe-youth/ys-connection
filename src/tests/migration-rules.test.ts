import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Rules for every migration at once. Totals, not per-file counts: 0001 creates 13 tables and 0002 enables their RLS.
const DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const sql = new Map(files.map((f) => [f, readFileSync(join(DIR, f), 'utf8').replace(/--[^\r\n]*/g, '')]));
const count = (re: RegExp) => [...sql.values()].reduce((n, s) => n + (s.match(re) ?? []).length, 0);
const DESTRUCTIVE_OK = ['0026', '0044', '0054'];

describe('migrations', () => {
  it('every created table has RLS enabled (totals match)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(count(/create\s+table/gi)).toBe(count(/enable\s+row\s+level\s+security/gi));
  });
  it('no drop table, drop column, rename or concurrently outside the three known files', () => {
    const bad = files.filter((f) => !DESTRUCTIVE_OK.includes(f.slice(0, 4)) && /drop\s+table|drop\s+column|\brename\b|concurrently/i.test(sql.get(f)!));
    expect(bad).toEqual([]);
  });
});
