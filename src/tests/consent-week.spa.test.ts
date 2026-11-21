// Consent automation A2: the "This week" sheet (screen consentweek). The push opens it for one date; it counts that date's rows and
// one Run starts the existing Save all / Text all chains (no second confirm: the Run tap is the confirm, R4). Held rows never go.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const FNS = ['esc', '_navRoute', '_cwRows', '_cwCounts', '_cwOpen', '_cwSheet', '_cwRun', '_cwNext'];
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const P = (n: number) => `9e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = '2026-11-27';
const flush = () => new Promise((r) => setTimeout(r, 0));

// bulk: what _hubBulkRows(M, kind) returns per kind; kids: the family kids (for held / unclear counts)
function env(o: { bulk?: Record<string, any[]>; kids?: any[]; nearPurge?: number; hub?: boolean } = {}) {
  const calls = { go: [] as string[], modal: [] as string[], bulk: [] as any[], toasts: [] as string[] };
  const I: any = { nearPurge: o.nearPurge || 0, hub: o.hub === false ? null : { lists: {} } };
  const f = new Function('ARGS', `
    const { calls, I, o } = ARGS;
    const history = { replaceState: () => {} }, location = { search: '', pathname: '/' };
    const _lkDay = (d) => d, go = (p) => calls.go.push(p), modal = (h) => calls.modal.push(h), closeModal = () => {}, toast = (m) => calls.toasts.push(m);
    const _ik = () => I, _hubM = () => ({ fams: [{ kids: o.kids || [] }] }), _ikDraw = () => {};
    function _hubBulkRows(M, kind) { return (o.bulk || {})[kind] || []; }
    async function _hubBulkOpen(kind, wk, cw) { calls.bulk.push([kind, cw]); await null; }
    function _bdayList() {} function _lgremOpen() {}
    ${BODY}
    return { ${FNS.join(', ')} };`)({ calls, I, o });
  return { ...f, calls, I };
}
const row = (n: number, o: any = {}) => ({ key: P(n), title: 'Fam ' + n, status: 'ready', reason: '', outcome: '', ...o });
const at = (mode: string, n: number, o: any = {}, date = D) => [mode, { date, row: row(n, o) }];

describe('consentweek: deep link', () => {
  it('route consentweek with bad date → notices, no sheet', () => {
    const e = env();
    expect(e._navRoute({ screen: 'consentweek', mode: 'intake', date: '2026-02-31x' })).toBe(false);
    expect(e._navRoute({ screen: 'consentweek', mode: 'other', date: D })).toBe(false);
    expect(e.calls.go).toEqual(['notices', 'notices']);
    expect(e.calls.modal).toHaveLength(0);
  });
  it('a good link opens the hub and the sheet for that date', () => {
    const e = env();
    expect(e._navRoute({ screen: 'consentweek', mode: 'intake', date: D })).toBe(true);
    expect(e.calls.go).toEqual(['link-intake']);
    expect(e.calls.modal).toHaveLength(1);
    expect(e.I.cw).toMatchObject({ mode: 'intake', date: D });
  });
  it('hub not loaded yet: the sheet waits for the load (show flag)', () => {
    const e = env({ hub: false });
    e._cwOpen('consent', D);
    expect(e.calls.modal).toHaveLength(0);
    expect(e.I.cw.show).toBe(true);
  });
});

describe('consentweek: counts', () => {
  it('sheet counts match plan rows (intake): only that date, held by hold type, waiting not held', () => {
    const e = env({
      bulk: { save: [at('intake', 1), at('intake', 2), at('intake', 3, {}, '2026-11-20')], text: [at('intake', 4)] },
      kids: [{ intake: { date: D, row: row(5, { status: 'needs-you', reason: 'Same person?' }) } },
        { intake: { date: D, row: row(6, { status: 'needs-you', reason: 'Same person?' }) } },
        { intake: { date: D, row: row(7, { status: 'needs-you', reason: 'Waiting for replies until Friday 6 am' }) } },
        { intake: { date: D, row: row(8, { status: 'needs-you', reason: 'Saved before, not in Elvanto now' }) } },
        { intake: { date: '2026-11-20', row: row(9, { status: 'needs-you', reason: 'Check the match' }) } }],
      nearPurge: 2,
    });
    expect(e._cwCounts('intake', D)).toEqual({ save: 2, text: 1, record: 0, assume: 0, move: 0, held: 3,
      holds: { 'Same person?': 2, 'Saved before, not in Elvanto now': 1 }, unclear: 1, nearPurge: 2 });
  });
  it('sheet counts match plan rows (consent): record / assume / move', () => {
    const e = env({ bulk: { consent: [at('consent', 1, { outcome: 'Contact allowed' }), at('consent', 2, { outcome: 'No contact' }), at('consent', 3, { outcome: 'No reply: assume consent' })] } });
    expect(e._cwCounts('consent', D)).toMatchObject({ record: 2, assume: 1, move: 3, held: 0 });
  });
  it('the sheet names counts only and its Run is off with nothing to do', () => {
    const e = env();
    e._cwOpen('intake', D);
    expect(e.calls.modal[0]).toContain('Nothing to run');
    expect(e.calls.modal[0]).not.toContain('_cwRun()');
  });
});

describe('consentweek: Run', () => {
  it('intake: Save all for that date with no second confirm, then Text all once the saves land', async () => {
    const e = env({ bulk: { save: [at('intake', 1)] } });
    e._cwOpen('intake', D);
    await e._cwRun();
    expect(e.calls.bulk).toEqual([['save', { date: D, auto: true }]]);
    expect(e.I.cwChain).toMatchObject({ date: D });
    // the saves landed and the console re-pushed: now a text row
    e.I.hubSend = null;
    e._cwNext();
    expect(e.calls.bulk.length).toBe(1); // no text rows yet: the chain waits
    expect(e.I.cwChain).not.toBeNull();
  });
  it('the chain texts when text rows appear, then ends', async () => {
    const e = env({ bulk: { text: [at('intake', 4)] } });
    e.I.cw = { mode: 'intake', date: D };
    e.I.cwChain = { date: D, at: Date.now() };
    e._cwNext();
    await flush();
    expect(e.calls.bulk).toEqual([['text', { date: D, auto: true }]]);
    expect(e.I.cwChain).toBeNull();
  });
  it('the chain gives up after 10 min with no text rows', () => {
    const e = env();
    e.I.cwChain = { date: D, at: Date.now() - 601e3 };
    e._cwNext();
    expect(e.I.cwChain).toBeNull();
    expect(e.calls.bulk).toHaveLength(0);
  });
  it('the chain waits while a save batch is still running', () => {
    const e = env({ bulk: { text: [at('intake', 4)] } });
    e.I.cwChain = { date: D, at: Date.now() };
    e.I.hubSend = { ids: ['a', 'b'], done: 1 };
    e._cwNext();
    expect(e.calls.bulk).toHaveLength(0);
  });
  it('consent: one Save all for that date', async () => {
    const e = env({ bulk: { consent: [at('consent', 1, { outcome: 'Contact allowed' })] } });
    e._cwOpen('consent', D);
    await e._cwRun();
    expect(e.calls.bulk).toEqual([['consent', { date: D, auto: true }]]);
    expect(e.I.cwChain || null).toBeNull();
  });
  it('run is single-flight', async () => {
    const e = env({ bulk: { save: [at('intake', 1)] } });
    e._cwOpen('intake', D);
    await Promise.all([e._cwRun(), e._cwRun()]);
    expect(e.calls.bulk).toHaveLength(1);
  });
});

describe('consentweek: _hubBulkOpen auto (the Run was the confirm)', () => {
  const B = extractFn(HTML, '_hubBulkOpen');
  function run(cw: any) {
    const calls = { modal: 0, go: 0, fresh: [] as string[] };
    const I: any = { hub: { lists: {} } };
    const rows = [['consent', { date: D, row: row(1, { outcome: 'Contact allowed' }) }], ['consent', { date: '2026-11-20', row: row(2) }]];
    const f = new Function('ARGS', `const { calls, I, rows } = ARGS;
      const _ik = () => I, _hubM = () => ({}), _hubWkM = (m) => m, _ikSt = () => ({}), _ikDraw = () => {}, _here = () => 1, _still = () => true;
      const _hubBulkRows = () => rows, modal = () => { calls.modal++; }, toast = () => {}, esc = (x) => x;
      const API = { fresh: async (u) => { calls.fresh.push(u); return { row: {}, detail: {} }; } };
      function _ikSaveAllItems(d, date) { return { items: [{ key: date, title: 't', outcome: '', payload: {} }], skipped: [] }; }
      function _ikSaveAllGo() { calls.go++; } const _ikSaveAllGroups = () => '', _ikD26 = () => '';
      ${B}
      return _hubBulkOpen;`)({ calls, I, rows });
    return { f, calls };
  }
  it('auto: that date only, no modal, straight to the save', async () => {
    const { f, calls } = run(null);
    await f('consent', null, { date: D, auto: true });
    expect(calls.fresh).toHaveLength(1);
    expect(calls.modal).toBe(0);
    expect(calls.go).toBe(1);
  });
  it('no cw: today\'s confirm modal as before', async () => {
    const { f, calls } = run(null);
    await f('consent', null);
    expect(calls.fresh).toHaveLength(2);
    expect(calls.modal).toBe(1);
    expect(calls.go).toBe(0);
  });
});
