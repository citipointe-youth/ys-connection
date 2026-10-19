import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

// CY-A1 (review 2026-10-19): the admin settles an unclear row: Landed / Not landed, a confirm sheet,
// then POST /link/admin/unclear/:id { landed }. A 404/409 shows the server's message.
const ROW = { id: 'a1', type: 'checkIn', status: 'unclear', name: 'Amy Adams', leaderName: 'Dana Day', detail: 'lease-lost' };

function env() { // the POST answer comes from globalThis.__post
  return loadFns(['_lkAdmUnclearOpen', '_lkAdmUnclearGo'], `
    const LINK = { adm: { acts: [${JSON.stringify(ROW)}] } };
    const out = { modal: '', toast: '', closed: 0, posts: [], reloads: 0 };
    function esc(s) { return String(s); } function _lkVerb(t) { return t === 'checkIn' ? 'Check in' : t; }
    function modal(h) { out.modal = h; } function closeModal() { out.closed++; } function toast(t) { out.toast = t; }
    const API = { post: (p, b) => { out.posts.push([p, b]); return __post(p, b); } };
    async function _lkAdmLoadActs() { out.reloads++; }
    function __o() { return out; }`, ['_lkAdmUnclearOpen', '_lkAdmUnclearGo', '__o']);
}

describe('CY-A1 admin Landed / Not landed on an unclear row', () => {
  it('opens a confirm naming the action; only the sheet button posts { landed }', async () => {
    let posted: unknown[] = [];
    (globalThis as any).__post = async (p: string, b: unknown) => { posted = [p, b]; return { ok: true, status: 'sent' }; };
    const f = env();
    f._lkAdmUnclearOpen('a1', true);
    const o = f.__o();
    expect(o.modal).toContain('Check in · Amy Adams');
    expect(o.modal).toContain('_lkAdmUnclearGo()');
    expect(o.posts).toHaveLength(0);
    await f._lkAdmUnclearGo();
    expect(posted).toEqual(['/link/admin/unclear/a1', { landed: true }]);
    expect(o.reloads).toBe(1);
    expect(o.toast).toMatch(/Saved/);
  });

  it('Not landed posts landed:false; a 409 shows the server message and still reloads', async () => {
    (globalThis as any).__post = async () => { throw Object.assign(new Error('This is no longer waiting for a check.'), { status: 409 }); };
    const f = env();
    f._lkAdmUnclearOpen('a1', false);
    expect(f.__o().modal).toMatch(/Not landed/);
    await f._lkAdmUnclearGo();
    expect(f.__o().posts[0]).toEqual(['/link/admin/unclear/a1', { landed: false }]);
    expect(f.__o().toast).toBe('This is no longer waiting for a check.');
    expect(f.__o().reloads).toBe(1);
  });

  it('the Status card puts both buttons on each unclear row (ids only in the handler)', () => {
    const { _lkAdmStatusHtml } = loadFns(['_lkAdmStatusHtml'], `
      const LINK = { status: { console: { lastSeenAt: null }, mirrors: {} }, adm: { acts: [${JSON.stringify(ROW)}], aErr: null } };
      function esc(s) { return String(s); } function icS() { return ''; } function _lkEvents() { return {}; } function _lkWord(a, b) { return b; }
      function _lkRevLine() { return ''; } function _lkVerb(t) { return t; } function progBar() { return ''; } function _lkAt() { return ''; }`);
    const h = _lkAdmStatusHtml();
    expect(h).toContain(`_lkAdmUnclearOpen('a1',true)`);
    expect(h).toContain(`_lkAdmUnclearOpen('a1',false)`);
    expect(h).toMatch(/>Landed</);
    expect(h).toMatch(/>Not landed</);
  });
});
