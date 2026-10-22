import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
// Spec §9: removal leaves no bus_consents references outside migrations, docs and the 0044 contract test (pre-flight F24).
describe('bus_consents is gone', () => {
  it('git grep finds no old consent table or API names in code', () => {
    let out = '';
    try {
      // execFileSync with an argv array: no shell, so the pathspecs quote the same on Windows and Linux CI.
      out = execFileSync('git', ['grep', '-l', '-w', '-e', 'bus_consents', '-e', 'BusConsent', '-e', 'listConsents', '-e', 'getConsent',
        '-e', 'saveConsent', '-e', 'setConsent', '--', '.', ':!supabase/migrations', ':!docs', ':!*.md', ':!CHANGELOG.txt',
        ':!src/tests/bus-consent-removal.test.ts', ':!src/tests/link-contract.test.ts'],
        { cwd: join(__dirname, '..', '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e: any) {
      if (e.status !== 1) throw e; // git grep exits 1 when nothing matches: that is the pass
    }
    expect(out).toBe('');
  });
});
