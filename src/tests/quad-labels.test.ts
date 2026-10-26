import { describe, it, expect } from 'vitest';
import { QUADS, quadLabelFor } from '../core/types/enums';

describe('quadLabelFor', () => {
  it('returns the Junior/Senior names (no "Yr" text left)', () => {
    expect(quadLabelFor('g79')).toBe('Junior Girls');
    expect(quadLabelFor('b79')).toBe('Junior Guys');
    expect(quadLabelFor('g1012')).toBe('Senior Girls');
    expect(quadLabelFor('b1012')).toBe('Senior Guys');
  });
});

describe('QUAD_USERNAMES (migration 0022)', () => {
  it('maps the old quad ids to the new logins, matching the seed and the migration', async () => {
    const { QUAD_USERNAMES } = await import('../core/types/enums');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(QUAD_USERNAMES).toEqual({ g79: 'juniorgirls', b79: 'juniorguys', g1012: 'seniorgirls', b1012: 'seniorguys' });
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0022_rename_quad_accounts.sql'), 'utf8');
    for (const q of QUADS) expect(sql).toContain(`('${q}','${QUAD_USERNAMES[q]}','${quadLabelFor(q)}')`);
  });
});
