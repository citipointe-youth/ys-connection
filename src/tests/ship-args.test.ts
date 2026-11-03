// Security review 2026-11-04 (item 25b): ship.sh refuses an unknown argument before anything happens. Runs only the argument block
// lifted from the file; ship.sh itself never runs here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const src = readFileSync(join(__dirname, '..', '..', 'scripts', 'ship.sh'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('DRY= PROMOTE= BR=');
const end = src.indexOf('run() {');
const block = src.slice(start, end);
const run = (...args: string[]) => spawnSync('bash', ['-c', `${block}\necho "ok:$DRY:$PROMOTE:$BR"`, 'ship', ...args], { encoding: 'utf8' });
const noBash = spawnSync('bash', ['-c', 'true']).status !== 0;

describe.skipIf(noBash)('ship.sh arguments', () => {
  it('the block sits before the first command that does anything', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(0, start)).not.toMatch(/\b(git|npm|node|cd)\b(?![^\n]*#)|^\s*git /m);
  });
  it('--help, a typo and a second branch exit 2 and go no further', () => {
    for (const args of [['--help'], ['-h', 'br'], ['--dryrun', 'br'], ['br', '--bogus'], ['br', 'other']]) {
      const r = run(...args);
      expect([args, r.status, r.stdout]).toEqual([args, 2, '']);
    }
  });
  it('no branch still exits 2', () => { expect(run('--dry-run').status).toBe(2); });
  it('the real flags and a branch still parse', () => {
    expect(run('--dry-run', '--promote', 'sec/x').stdout.trim()).toBe('ok:1:1:sec/x');
    expect(run('sec/x').stdout.trim()).toBe('ok:::sec/x');
  });
});
