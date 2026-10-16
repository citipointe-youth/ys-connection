// Plan F (#0): the door polls GET /link/actions?ids= for this phone's own pending check-in rows, so a tap flips to
// "In Elvanto" within ~5 s of the console's result instead of the next 60 s list reload. Extract-and-run: the REAL
// functions from public/index.html.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const FNS = ['_lkApply', '_lkCiWaiting', '_lkCiPoll'];
const prelude = `
  const __c = globalThis.__ci;
  const S = { user: { id: 'u1', role: 'grade' }, get page() { return __c.page; } };
  let LINK = null;
  function __link(v) { if (v !== undefined) LINK = v; return LINK; }
  const document = { get visibilityState() { return __c.vis; } };
  const Date = { now: () => __c.now };
  const setTimeout = (f, ms) => { __c.timers.push({ f, ms }); return __c.timers.length; };
  const API = { fresh: async (url, quiet) => { __c.urls.push(url); if (__c.fail) throw new Error('offline'); return __c.reply; } };
  const _lkLoadPeople = async (svc, quiet) => { __c.loads.push(svc); return true; };
  const _lkRefreshView = () => { __c.refresh++; };
`;
const id = (n: number) => `0a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const act = (n: number, status = 'pending', type = 'checkIn') => ({ id: id(n), type, status, reason: null });
const person = (n: number, o: Record<string, unknown> = {}) =>
  ({ personId: 'p' + n, name: 'P' + n, checkedIn: true, mine: true, action: act(n), ...o });

function env(people: any[], leaders: any[] = [], o: Record<string, unknown> = {}) {
  const c: any = { page: 'link-checkin', vis: 'visible', now: 0, timers: [], urls: [], loads: [], refresh: 0, reply: [], fail: false, ...o };
  (globalThis as any).__ci = c;
  const f = loadFns(FNS, prelude, [...FNS, '__link']);
  f.__link({ svc: 'S1', people: { S1: { people, leaders } }, loadGen: 0, resGen: 0 });
  return { f, c, L: () => f.__link() };
}
const idsOf = (url: string) => decodeURIComponent(url.split('?ids=')[1] ?? '').split(',').filter(Boolean);

describe('Plan F: door check-in polls its own pending rows by id', () => {
  it('polls only this phone\'s pending/claimed rows (people and leaders), every 5 s at first', async () => {
    const { f, c } = env([
      person(1), person(2, { action: act(2, 'claimed') }), person(3, { mine: false }),
      person(4, { action: act(4, 'sent') }), person(5, { action: null, checkedIn: false }),
    ], [person(6, { action: act(6, 'pending') })]);
    f._lkCiPoll();
    expect(c.timers.map((t: any) => t.ms)).toEqual([5000]);
    await c.timers[0].f();
    expect(c.urls).toHaveLength(1);
    expect(c.urls[0].startsWith('/link/actions?ids=')).toBe(true);
    expect(idsOf(c.urls[0])).toEqual([id(1), id(2), id(6)]);
  });

  it('a sent answer flips the row in place (check-in in, check-out out); no list reload', async () => {
    const at = '2026-10-23T08:00:00.000Z';
    const { f, c, L } = env([person(1), person(2, { action: act(2, 'claimed') }),
      person(7, { action: act(7, 'pending', 'checkOut'), checkedIn: false })]);
    c.reply = [{ id: id(1), type: 'checkIn', status: 'sent', reason: null, resultAt: at },
      { id: id(2), type: 'checkIn', status: 'claimed', reason: null }, { id: id(7), type: 'checkOut', status: 'sent', reason: null, resultAt: at }];
    f._lkCiPoll();
    await c.timers[0].f();
    const ps = L().people.S1.people;
    expect(ps[0]).toMatchObject({ checkedIn: true, mine: true, action: { id: id(1), status: 'sent', resultAt: at } });
    expect(ps[1].action.status).toBe('claimed');
    expect(ps[2]).toMatchObject({ checkedIn: false, action: { status: 'sent' } });
    expect(c.loads).toEqual([]);
    expect(c.refresh).toBe(1); // the real _lkRefreshView repaints and re-arms the poll
  });

  it('refused or cancelled answers reload the list once (the server decides the checked-in state)', async () => {
    const { f, c, L } = env([person(1), person(2)]);
    c.reply = [{ id: id(1), type: 'checkIn', status: 'refused', reason: 'no-room' }, { id: id(2), type: 'checkIn', status: 'cancelled', reason: null }];
    f._lkCiPoll();
    await c.timers[0].f();
    expect(c.loads).toEqual(['S1']);
    expect(L().people.S1.people[0].action.status).toBe('pending'); // untouched locally; the reload brings the truth
    expect(c.refresh).toBe(1);
  });

  it('arms nothing when nothing waits, off the door page, while hidden, or when already armed', () => {
    expect((() => { const { f, c } = env([person(1, { action: act(1, 'sent') })]); f._lkCiPoll(); return c.timers.length; })()).toBe(0);
    expect((() => { const { f, c } = env([person(1)], [], { page: 'link-groups' }); f._lkCiPoll(); return c.timers.length; })()).toBe(0);
    expect((() => { const { f, c } = env([person(1)], [], { vis: 'hidden' }); f._lkCiPoll(); return c.timers.length; })()).toBe(0);
    const { f, c } = env([person(1)]);
    f._lkCiPoll(); f._lkCiPoll(); f._lkCiPoll();
    expect(c.timers).toHaveLength(1);
  });

  it('an armed poll does nothing if the page, visibility, service or login changed before it fired', async () => {
    for (const change of ['page', 'vis', 'svc', 'login'] as const) {
      const { f, c, L } = env([person(1)]);
      f._lkCiPoll();
      if (change === 'page') c.page = 'home';
      if (change === 'vis') c.vis = 'hidden';
      if (change === 'svc') L().svc = 'S2';
      if (change === 'login') f.__link({ svc: 'S1', people: { S1: { people: [person(1)], leaders: [] } }, loadGen: 0, resGen: 0 });
      await c.timers[0].f();
      expect([change, c.urls.length, c.refresh]).toEqual([change, 0, 0]);
    }
  });

  it('slows to 15 s after 2 min and drops a row after 10 min (the 60 s reload still covers it)', () => {
    const { f, c, L } = env([person(1)]);
    f._lkCiPoll();                       // first seen at t=0
    c.now = 120_001; L().ciT = null; f._lkCiPoll();
    c.now = 600_001; L().ciT = null; f._lkCiPoll();
    expect(c.timers.map((t: any) => t.ms)).toEqual([5000, 15000]);
  });

  it('caps one call at 200 ids, newest kept', async () => {
    const { f, c } = env(Array.from({ length: 250 }, (_, i) => person(i + 1)));
    f._lkCiPoll();
    await c.timers[0].f();
    const ids = idsOf(c.urls[0]);
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe(id(51));
    expect(ids[199]).toBe(id(250));
  });

  it('a failed fetch is silent: no reload, one repaint (which re-arms)', async () => {
    const { f, c } = env([person(1)], [], { fail: true });
    f._lkCiPoll();
    await expect(c.timers[0].f()).resolves.toBeUndefined();
    expect(c.loads).toEqual([]);
    expect(c.refresh).toBe(1);
  });

  it('every door repaint re-arms the poll (a wake from sleep repaints via the status load)', () => {
    expect(extractFn(HTML, '_lkRefreshView')).toContain("if (S.page === 'link-checkin') _lkCiPoll();");
  });
});
