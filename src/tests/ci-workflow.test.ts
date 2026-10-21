import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// R1 H4 (2026-10-22): CI must run every migration and the real-Postgres repo suite, or the DB paths go untested again.
const ci = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');

describe('CI workflow', () => {
  it('starts a Postgres service', () => expect(ci).toMatch(/services:\s*\n\s+postgres:\s*\n\s+image: postgres:\d+/));
  it('applies every migration with the real runner, twice (the second run must be a no-op)', () => {
    expect(ci.match(/npx tsx scripts\/migrate\.ts --force/g)?.length).toBe(2);
  });
  it('runs the test suite with LINK_TEST_DATABASE_URL set, so the repo suite is not skipped', () => {
    expect(ci).toMatch(/LINK_TEST_DATABASE_URL: postgres:\/\/postgres:postgres@localhost:5432\/postgres/);
  });
});
