// Nav/save fix round 2026-10-16, lane n3 (Consents): C-B4, C-B9 (consent), S-1 (consent restore), S-3 (Save all), D6, D7, B02.
// Extract-and-run: the REAL functions from public/index.html run against small stubs.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const src = (names: string[]) => names.map((n) => extractFn(HTML, n)).join('\n');
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// One intake state + the stubs every lane-n3 function touches. `t` records what happened.
function env(names: string[], o: { fresh?: (p: string) => any; post?: (items: any[]) => any; I?: any } = {}) {
  const t: any = { modals: [] as string[], toasts: [] as string[], posts: [] as any[][], fresh: [] as string[], draws: 0, closed: 0, timers: [] as any[], uuid: 0 };
  const I: any = Object.assign({ tab: 'consent', date: '2026-10-16', key: null, csub: 'last', list: { rows: [] }, fixes: {}, lk: {}, saErr: {},
    saBusy: false, sa: null, fixPoll: null, head: null }, o.I || {});
  const fns = new Function('__t', '__I', '__fresh', '__post', `
    const S = { page: 'link-intake' };
    const NAV = { stack: [] };
    const LINK = { gid: null, rf: null, ik: __I };
    const document = { querySelector: () => null, getElementById: () => null };
    const navigator = { onLine: true };
    const _ik = () => LINK.ik;
    const API = { fresh: (p) => { __t.fresh.push(p); return Promise.resolve().then(() => __fresh(p)); } };
    const _ikPost = (items) => { __t.posts.push(items); return Promise.resolve().then(() => { const r = __post(items); return (r && r.results) || []; }); };
    const _ikOutcome = (res, id) => (res || []).find((r) => r && r.id === id) || null;
    const _lkUuid = () => 'id-' + (++__t.uuid);
    const modal = (h) => __t.modals.push(h);
    const closeModal = () => { __t.closed++; };
    const toast = (m) => __t.toasts.push(m);
    const _ikDraw = () => { __t.draws++; };
    const _ikLoad = () => {};
    const _ikLocal = () => {};
    const _ikSt = () => null;
    const _ikSeenLine = () => '';
    const _lkSeen = (iso) => 'SEEN(' + iso + ')';
    const setTimeout = (cb, ms) => { __t.timers.push(ms); return 1; };
    const clearTimeout = () => {};
    const esc = (s) => String(s);
    ${src(names)}
    return { ${names.join(', ')}, S, NAV, LINK };`)(t, I, o.fresh ?? (() => ({})), o.post ?? ((items: any[]) => ({ results: items.map((i) => ({ id: i.id, kind: 'action', outcome: 'saved' })) })));
  return { fns, t, I };
}
const GUARD = ['_navSnap', '_navSame', '_here', '_still'];

describe('C-B4 Save all opens its sheet only where it started', () => {
  const names = [...GUARD, '_ikSaveAllOpen'];
  const stubs = `const _ikReadyRows = (l) => l.rows; const _ikSaveAllItems = (dets) => ({ items: dets.map((d) => ({ key: d.row.key, title: d.row.title, outcome: '', payload: {} })), skipped: [] });
    const _ikSaveAllGroups = () => ''; const _ikD26 = () => '';`;
  function run(change?: (fns: any) => void) {
    const t: any = { modals: [] as string[], draws: 0 };
    const I: any = { tab: 'consent', date: '2026-10-16', key: null, csub: 'last', list: { rows: [{ key: P(1), title: 'Ava' }] }, saBusy: false, saErr: {} };
    let fns: any;
    fns = new Function('__t', '__I', '__chg', `
      const S = { page: 'link-intake' }; const NAV = { stack: [] }; const LINK = { gid: null, rf: null, ik: __I };
      const document = { querySelector: () => null };
      const _ik = () => LINK.ik; const _ikSt = () => null; const esc = (s) => String(s); const toast = () => {};
      const _ikDraw = () => { __t.draws++; }; const modal = (h) => __t.modals.push(h);
      const API = { fresh: () => Promise.resolve().then(() => { __chg(); return { row: { key: '${P(1)}', title: 'Ava' }, detail: {} }; }) };
      ${stubs}
      ${src(names)}
      return { _ikSaveAllOpen, S, NAV, LINK };`)(t, I, () => change && change(fns));
    return { fns, t, I };
  }
  it('still on the list -> the confirm sheet opens', async () => {
    const { fns, t } = run();
    await fns._ikSaveAllOpen();
    expect(t.modals.length).toBe(1);
  });
  it('went Home while the rows were read -> no sheet, busy cleared', async () => {
    const { fns, t, I } = run((f) => { f.S.page = 'home'; });
    await fns._ikSaveAllOpen();
    expect(t.modals.length).toBe(0);
    expect(I.saBusy).toBe(false);
  });
  it('opened a family while the rows were read -> no sheet', async () => {
    const { fns, t } = run((f) => { f.LINK.ik.key = P(9); });
    await fns._ikSaveAllOpen();
    expect(t.modals.length).toBe(0);
  });
});

describe('S-3 Save all sends chunks of 20 and says when a chunk will go again by itself', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ key: P(i + 1), title: 'Kid ' + i, outcome: '', payload: { row: P(i + 1) } }));
  it('45 items -> 3 POSTs of 20, 20, 5', async () => {
    const { fns, t, I } = env(['_ikSaveAllGo']);
    I.sa = { type: 'consentSave', date: '2026-10-16', items: items(45) };
    await fns._ikSaveAllGo();
    expect(t.posts.map((p: any[]) => p.length)).toEqual([20, 20, 5]);
  });
  it('a chunk that never got an answer (kept on the phone) says it goes again; a 4xx says why', async () => {
    let n = 0;
    const { fns, I } = env(['_ikSaveAllGo'], { post: () => { n++; if (n === 1) throw new Error("Can't reach the server"); const e: any = new Error('Only the admin can do this.'); e.status = 403; throw e; } });
    I.sa = { type: 'consentSave', date: '2026-10-16', items: items(25) };
    await fns._ikSaveAllGo();
    expect(I.saErr[P(1)]).toBe('Not sent yet. It goes again by itself.');
    expect(I.saErr[P(21)]).toBe('Only the admin can do this.');
  });
  it('a 5xx is kept too', async () => {
    const { fns, I } = env(['_ikSaveAllGo'], { post: () => { const e: any = new Error('Server error'); e.status = 503; throw e; } });
    I.sa = { type: 'consentSave', date: '2026-10-16', items: items(1) };
    await fns._ikSaveAllGo();
    expect(I.saErr[P(1)]).toBe('Not sent yet. It goes again by itself.');
  });
});
