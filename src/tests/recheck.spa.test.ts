import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

// L7 (round 2026-10-21, LINK_REV 15): "Check again" on an unclear save. POST /link/admin/unclear/:id/recheck queues a read-only
// re-check on the console; the SPA polls GET /link/admin/recheck/:rid and shows Saved / Not saved / Still unclear in words.
const ROW = { id: 'a1', type: 'checkIn', status: 'unclear', name: 'Amy Adams', leaderName: 'Dana Day', detail: 'lease-lost' };

function env(answers: unknown[], post: (p: string) => unknown = () => ({ id: 'r1' })) {
  return loadFns(['_lkRecheck'], `
    const out = { posts: [], gets: [], els: {} };
    const _LK_RC = {};
    function esc(s) { return String(s); }
    const document = { getElementById: (id) => (out.els[id] = out.els[id] || { outerHTML: '' }) };
    const API = { post: async (p, b) => { out.posts.push(p); return (${post.toString()})(p); },
      fresh: async (p) => { out.gets.push(p); const a = __answers.shift(); if (a instanceof Error) throw a; return a; } };
    const __answers = ${JSON.stringify(answers)};
    function setTimeout(fn) { fn(); }
    function __o() { return { out, rc: _LK_RC }; }`, ['_lkRecheck', '_lkRcHtml', '__o']);
}

describe('L7 SPA: Check again', () => {
  it('the button shows only when the console takes recheck; a result shows its words, and Check again stays while still unclear', () => {
    const { _lkRcHtml } = loadFns(['_lkRcHtml'], 'const _LK_RC = { b2: { state: "saved", text: "Saved in Elvanto." }, c3: { state: "unclear", text: "Still unclear: x" } }; function esc(s) { return String(s); }');
    expect(_lkRcHtml('a1', {})).toBe('');
    expect(_lkRcHtml('a1', { recheck: 'off' })).toBe('');
    const h = _lkRcHtml('a1', { recheck: 'live' });
    expect(h).toContain(`onclick="_lkRecheck('a1')"`);
    expect(h).toContain('>Check again<');
    expect(h).toContain('id="lk-rc-a1"');
    const s = _lkRcHtml('b2', { recheck: 'live' });
    expect(s).toContain('Saved in Elvanto.');
    expect(s).not.toContain('Check again');
    expect(_lkRcHtml('c3', { recheck: 'live' })).toContain('Check again');
  });
  it('posts the recheck, polls until an answer, and keeps the answer', async () => {
    const f = env([{ state: 'checking', text: 'Checking Elvanto…' }, { state: 'not-saved', text: 'Not saved in Elvanto. Send it again from the app if it is still needed.' }]);
    await f._lkRecheck('a1');
    const { out, rc } = f.__o();
    expect(out.posts).toEqual(['/link/admin/unclear/a1/recheck']);
    expect(out.gets).toEqual(['/link/admin/recheck/r1', '/link/admin/recheck/r1']);
    expect(rc.a1).toEqual({ state: 'not-saved', text: 'Not saved in Elvanto. Send it again from the app if it is still needed.' });
    expect(out.els['lk-rc-a1'].outerHTML).toContain('Not saved in Elvanto.');
  });
  it('a refused ask (an older console) shows the server words', async () => {
    const f = env([], () => { throw new Error('Do this in Elvanto for now.'); });
    await f._lkRecheck('a1');
    expect(f.__o().rc.a1).toEqual({ state: 'unclear', text: 'Do this in Elvanto for now.' });
  });
  it('no answer after the polls: says so, and Check again can be tapped again', async () => {
    const f = env(Array.from({ length: 70 }, () => ({ state: 'checking', text: 'Checking Elvanto…' })));
    await f._lkRecheck('a1');
    expect(f.__o().rc.a1.state).toBe('unclear');
    expect(f.__o().rc.a1.text).toMatch(/not answered yet/);
  });
  it('the admin Status card puts Check again on each unclear row; the Consents fix line too', () => {
    const { _lkAdmStatusHtml } = loadFns(['_lkAdmStatusHtml'], `
      const LINK = { status: { console: { lastSeenAt: null, capabilities: { recheck: 'live' } }, mirrors: {} }, adm: { acts: [${JSON.stringify(ROW)}], aErr: null } };
      function esc(s) { return String(s); } function icS() { return ''; } function _lkEvents() { return {}; } function _lkWord(a, b) { return b; }
      function _lkRevLine() { return ''; } function _lkVerb(t) { return t; } function progBar() { return ''; } function _lkAt() { return ''; }`);
    const h = _lkAdmStatusHtml();
    expect(h).toContain(`_lkRecheck('a1')`);
    expect(h).toContain(`_lkAdmUnclearOpen('a1',true)`); // the manual way stays
  });
  it('Home: the admin line points at Check again', async () => {
    const { _attnLines } = loadFns(['_attnLines'], '');
    const l = _attnLines({ role: 'admin', unclear: 1, errors: 0, unsent: 0, waiting: 0, fix: [] }).map((x: string[]) => x[0]);
    expect(l[0]).toBe('1 unclear save. Tap Check again in Admin > Elvanto link, or check it in Elvanto and mark it there.');
  });
});
