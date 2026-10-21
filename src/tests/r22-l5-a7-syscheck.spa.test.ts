// Round 2026-10-22 admin lane L5, A7: the System check paints a loading bar and never crashes on a 401/403.
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const ST = { checks: [{ id: 'db', label: 'Database connection', state: 'ok' }] };

function sysEnv(load: string) {
  return loadFns(['renderSystemCheck', '_setupChecklistHtml'], `
    const el = { innerHTML: '' }, seen = [];
    const document = { getElementById: (id) => id === 'sys-check' ? el : null };
    const SETUP = { status: null, error: null, generated: {} };
    function esc(s) { return String(s); }
    function icS(k) { return '[' + k + ']'; }
    function progBar(s) { return '<bar ' + s + '>'; }
    async function _loadSetupStatus() { seen.push(el.innerHTML); ${load} }
    function __o() { return { el, seen }; }`, ['renderSystemCheck', '_setupChecklistHtml', '__o']);
}

describe('A7 System check: loading bar, and no crash on a 401/403', () => {
  it('paints a loading bar while /setup/status loads', async () => {
    const f = sysEnv(`SETUP.status = ${JSON.stringify(ST)}; return 'ok';`);
    await f.renderSystemCheck();
    expect(f.__o().seen[0]).toContain('<bar Loading>');
    expect(f.__o().el.innerHTML).toContain('Database connection');
  });
  it('a 401/403 (status null, no error) shows "Could not load. Try again." and a Check again button', async () => {
    const f = sysEnv(`SETUP.status = null; SETUP.error = null; return 'login';`);
    await f.renderSystemCheck();
    const h = f.__o().el.innerHTML;
    expect(h).toContain('Could not load. Try again.');
    expect(h).toContain('Check again');
  });
  it('a server error shows its message', async () => {
    const f = sysEnv(`SETUP.status = null; SETUP.error = 'Database is down'; return 'error';`);
    await f.renderSystemCheck();
    expect(f.__o().el.innerHTML).toContain('Database is down');
  });
});
