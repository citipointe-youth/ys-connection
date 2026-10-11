import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// The runner records versions by number only, so two files sharing a 4-digit prefix means one is skipped forever with
// no error (spec 2026-10-12-elvanto-link-app-design.md §2.5).
function duplicatePrefixes(files: string[]): Record<string, string[]> {
  const byPrefix: Record<string, string[]> = {};
  for (const f of files) {
    const m = /^(\d{4})_/.exec(f);
    if (m) (byPrefix[m[1]!] ??= []).push(f);
  }
  return Object.fromEntries(Object.entries(byPrefix).filter(([, v]) => v.length > 1));
}

describe('migration numbers', () => {
  it('reports a shared prefix (pure)', () => {
    expect(duplicatePrefixes(['0015_x.sql', '0016_a.sql', '0016_b.sql'])).toEqual({ '0016': ['0016_a.sql', '0016_b.sql'] });
  });
  it('no two files in supabase/migrations share a 4-digit prefix', () => {
    const files = readdirSync(join(__dirname, '..', '..', 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'));
    expect(duplicatePrefixes(files)).toEqual({});
  });
});
