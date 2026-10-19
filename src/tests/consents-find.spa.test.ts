// I6 (R2-G3): the flow step 0 "Consents" button opens the student on the Consents tab.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['_lkStepConsents', '_ikAfterLoad', '_ikFind', '_ikFormName', '_ikAnd', 'tidyName', '_ikLk', '_ikLkBusy', '_ikLkGate', '_ikRev', '_ikLkItem', '_ikLkGo'];
const HTML = loadIndexHtml();
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ST = (rev = 8, cap = 'live') => ({ consoleLinkRev: rev, console: { capabilities: { consentLookup: cap } } });

function env(o: { tab?: string; rows?: string[]; other?: Record<string, string[]>; st?: any; personId?: string | null; name?: string } = {}) {
  const t = { pushes: 0, opened: [] as number[], posts: [] as any[], gets: [] as string[], draws: 0, stored: [] as string[], went: [] as string[] };
  const I: any = { tab: o.tab ?? 'consent', lk: {}, resend: {}, busyKey: {}, det: null, list: null, dates: null, date: null, csub: 'last' };
  const row = { rowId: 'r1', personId: o.personId === undefined ? P(1) : o.personId, name: o.name ?? 'Amy Test' };
  const fns = new Function('__t', '__I', '__o', '__row', `
    const S = { page: 'link-flows' };
    const LINK = { fs: { rowId: 'r1' }, ik: __I };
    const _lkFlowRow = (id) => (id === 'r1' ? __row : null);
    const _ik = () => __I; const _ikSt = () => __I.head;
    const localStorage = { setItem: (k, v) => __t.stored.push(k + '=' + v) };
    const navPush = () => { __t.pushes++; };
    const closeModal = () => { LINK.fs = null; };
    const go = (p) => { __t.went.push(p); if (p !== S.page) navPush(); S.page = p; };
    const _ikLeave = () => {}; const _ikQFlush = () => {}; const _ikQFind = () => null; const _ikAnswerSend = () => {};
    const _ikDraw = () => { __t.draws++; }; const _ikOpen = (i) => { navPush(); __t.opened.push(i); };
    const _ikLkPoll = () => {}; const _lkUuid = () => 'u-1';
    const _ikPost = async (items) => { __t.posts.push(...items); return { results: items.map((x) => ({ id: x.id, outcome: 'saved' })) }; };
    const _ikOutcome = (r, id) => r.results.find((x) => x.id === id);
    const API = { fresh: async (p) => { __t.gets.push(p); const d = decodeURIComponent(p.split('date=')[1]); return { date: d, rows: (__o.other[d] || []).map((k) => ({ key: k })) }; } };
    ${BODY}
    function __load(rows, dates) { __I.dates = dates.map((d) => ({ date: d })); __I.date = dates[0]; __I.list = { date: dates[0], rows: rows.map((k) => ({ key: k })) }; __I.head = __o.st; _ikAfterLoad(); }
    return { ${FNS.join(', ')}, __load, S: () => S, LINK };`)(t, I, { other: o.other ?? {}, st: o.st ?? ST() }, row);
  return { fns, t, I };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const DATES = ['2026-10-16', '2026-10-09', '2026-10-02', '2026-09-25'];

describe('I6 step 0 Consents button', () => {
  it('(f) the button onclick is exactly _lkStepConsents()', () => {
    expect(extractFn(HTML, '_lkStepHtml')).toContain('onclick="_lkStepConsents()">Consents</button>');
    expect(HTML).not.toContain(`onclick="closeModal();go('link-intake')">Consents`);
  });
  it('(a) in the current week: Consents tab, Last Friday, their sheet opens', async () => {
    const { fns, t, I } = env();
    fns._lkStepConsents();
    expect(t.went).toEqual(['link-intake']);
    expect(I.find).toEqual({ personId: P(1), name: 'Amy Test' });
    fns.__load([P(9), P(1)], DATES);
    await flush();
    expect(I.tab).toBe('consent');
    expect(I.csub).toBe('last');
    expect(t.opened).toEqual([1]);
    expect(t.gets).toEqual([]);
  });
  it('(b) in another pushed week: that date is loaded, then opened (at most 2 more GETs)', async () => {
    const { fns, t, I } = env({ other: { '2026-10-02': [P(5), P(6), P(1)] } });
    fns._lkStepConsents();
    fns.__load([P(9)], DATES);
    await flush(); await flush(); await flush();
    expect(t.gets.length).toBe(2);
    expect(I.date).toBe('2026-10-02');
    expect(I.csub).toBe('last');
    expect(t.opened).toEqual([2]);
  });
  it('(c) in no week: Other, the name filled in, one consentLookup queued with that note', async () => {
    const { fns, t, I } = env();
    fns._lkStepConsents();
    fns.__load([P(9)], DATES);
    await flush(); await flush(); await flush(); await flush();
    expect(t.gets.length).toBe(2); // never more than 2 extra weeks
    expect(I.csub).toBe('other');
    expect(fns._ikLk('other').q).toBe('Amy Test');
    expect(t.posts.length).toBe(1);
    expect(t.posts[0]).toMatchObject({ type: 'consentLookup', payload: { kind: 'other', page: 1 }, note: 'Amy Test' });
    expect(t.opened).toEqual([]);
  });
  it('R5/R7 (consents run 2026-10-17): the step 0 name "Last, First" is searched and shown First Last, and remembered for the miss line', async () => {
    const { fns, t, I } = env({ personId: null, name: 'Alway, Kuyi' });
    fns._lkStepConsents();
    fns.__load([P(9)], DATES);
    await flush();
    expect(fns._ikLk('other').q).toBe('Kuyi Alway');
    expect(I.findMiss).toBe('Kuyi Alway');
    expect(t.posts[0]).toMatchObject({ note: 'Kuyi Alway' });
  });
  it('(c2) no person id: straight to Other, no extra GETs', async () => {
    const { fns, t, I } = env({ personId: null });
    fns._lkStepConsents();
    fns.__load([P(9)], DATES);
    await flush();
    expect(t.gets).toEqual([]);
    expect(I.csub).toBe('other');
    expect(t.posts.length).toBe(1);
  });
  it('(d) gate closed: the name is filled in, nothing queued', async () => {
    for (const st of [ST(8, 'off')]) {
      const { fns, t, I } = env({ personId: null, st });
      fns._lkStepConsents();
      fns.__load([], DATES);
      await flush();
      expect(I.csub).toBe('other');
      expect(fns._ikLk('other').q).toBe('Amy Test');
      expect(t.posts).toEqual([]);
    }
  });
  it('(e) the last tab was New youth: lands on Consents with only go()\'s navPush', () => {
    const { fns, t, I } = env({ tab: 'intake' });
    fns._lkStepConsents();
    expect(I.tab).toBe('consent');
    expect(t.stored).toEqual(['ysc.intakeTab=consent']);
    expect(t.pushes).toBe(1);
  });
  it('(g) I.find is used once: a later refresh does not jump', async () => {
    const { fns, t, I } = env();
    fns._lkStepConsents();
    fns.__load([P(1)], DATES);
    await flush();
    expect(I.find).toBeNull();
    fns.__load([P(1)], DATES);
    await flush();
    expect(t.opened).toEqual([0]);
  });
  it('no flow row open: nothing happens', () => {
    const { fns, t } = env();
    fns.LINK.fs = null;
    fns._lkStepConsents();
    expect(t.went).toEqual([]);
  });
});
