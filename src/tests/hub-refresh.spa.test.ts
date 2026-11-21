// Consent automation A3 (F5): Refresh waits until the console has re-read every date it asked for (5 s polls via _ikSchedule),
// then says "Updated h:mm"; at 120 s it gives up with "Console didn't answer" and keeps the old lists. Before this, a non-live
// snapshot cleared the ask at once and the one reload came before the console's push (the screen showed the old plan).
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, loadFns } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const KINDS = HTML.match(/^const IK_LK_KINDS = .*$/m)![0];
const D = '2026-11-27';
const at = (ms: number) => ({ rows: [], total: 0, takenAt: new Date(ms).toISOString() });

async function load(o: { askAgo?: number; live?: boolean; kinds?: any; dateAt?: number | null }) {
  const ask = Date.now() - (o.askAgo ?? 30e3), now = Date.now();
  const I: any = { gen: 0, hubAsk: ask, hubAskDates: ['intake|' + D], lkPre: 1 };
  const list = o.dateAt === null ? null : at(o.dateAt ?? now);
  const F = loadFns(['_hubLoad'], `${KINDS}
    const __I = ${JSON.stringify(I)}; const _ik = () => __I; const _ikSt = () => ({}); const LINK = {};
    const __snap = ${JSON.stringify({ live: o.live ?? true, kinds: o.kinds ?? { unlinked: at(now), mismatches: at(now), forms: at(now), other: null } })};
    const __list = ${JSON.stringify(list)};
    const API = { fresh: (u) => Promise.resolve(u.includes('snapshot') ? __snap : u.includes('date=') ? __list : u.includes('mode=intake') ? { dates: [{ date: '${D}' }] } : { dates: [] }) };
    const _linkOn = () => false; const _ikModuleOn = () => true; const _intakeOn = () => true; const _hubSnapApply = () => true; const _ikLkWarm = () => [];
    const _usLoad = () => Promise.resolve(); const _ikDraw = () => {}; const _ikSchedule = () => {}; const _ikFixRestore = () => {};
    const _lkTime = () => '7:52pm'; const toast = (m) => globalThis.__toasts.push(m);`, ['_hubLoad', '_ik']);
  const toasts: string[] = [];
  (globalThis as any).__toasts = toasts;
  await F._hubLoad(true);
  return { I: F._ik(), toasts };
}

describe('Refresh waits for the console (F5)', () => {
  it('an asked date still older than the ask keeps waiting, even with the consent lists newer', async () => {
    const r = await load({ dateAt: Date.now() - 864e5 });
    expect(r.I.hubAsk).not.toBe(0);
    expect(r.I.hubMsg || '').toBe('');
  });
  it('shows Updated <time> once every asked date is newer', async () => {
    const r = await load({});
    expect(r.I.hubAsk).toBe(0);
    expect(r.I.hubMsg).toBe('Updated 7:52pm');
  });
  it('non-live snapshot still waits for plan dates (the consent kinds do not count)', async () => {
    expect((await load({ live: false, kinds: {}, dateAt: Date.now() - 864e5 })).I.hubAsk).not.toBe(0);
    expect((await load({ live: false, kinds: {} })).I.hubMsg).toBe('Updated 7:52pm');
  });
  it('an unreadable date (null) never holds it open', async () => {
    expect((await load({ dateAt: null })).I.hubAsk).toBe(0);
  });
  it('gives up at 120s with "Console didn\'t answer", keeps old data, button usable again', async () => {
    const r = await load({ askAgo: 121e3, dateAt: Date.now() - 864e5 });
    expect(r.I.hubAsk).toBe(0);
    expect(r.I.hubMsg).toBe("Console didn't answer");
    expect(r.I.hub.lists['intake|' + D]).toBeTruthy();
  });
  it('still waiting at 119s', async () => {
    expect((await load({ askAgo: 119e3, dateAt: Date.now() - 864e5 })).I.hubAsk).not.toBe(0);
  });
});

describe('Refresh asks then polls', () => {
  it('non-live snapshot keeps the ask open (polls) and records the asked dates', async () => {
    const posts: any[] = [];
    const I: any = { hub: { lists: { ['intake|' + D]: {}, ['consent|' + D]: {} }, snap: { live: false } } };
    (globalThis as any).__I = I; (globalThis as any).__posts = posts;
    const F = loadFns(['_hubRefresh'], `
      const _ik = () => globalThis.__I; const _ikDraw = () => {}; const _hubWk = () => 'all';
      const _hubInWeek = () => true; const _lkWeekStart = (d) => d; const _ikLkGo = () => {};
      const API = { post: (p, b) => { globalThis.__posts.push([p, b]); return Promise.resolve({}); } };
      const _hubLoad = () => {};`, ['_hubRefresh']);
    await F._hubRefresh();
    expect(I.hubAsk).toBeGreaterThan(0);
    expect(I.hubAskDates.sort()).toEqual(['consent|' + D, 'intake|' + D]);
    expect(I.hubMsg).toBe('');
  });
  it('final review: an empty week on a non-live snapshot has nothing to wait for (no false console-did-not-answer)', async () => {
    const I: any = { hub: { lists: {}, snap: { live: false } } };
    (globalThis as any).__I = I; (globalThis as any).__posts = [];
    const F = loadFns(['_hubRefresh'], `
      const _ik = () => globalThis.__I; const _ikDraw = () => {}; const _hubWk = () => 'all';
      const _hubInWeek = () => true; const _lkWeekStart = (d) => d; const _ikLkGo = () => {};
      const API = { post: (p, b) => { globalThis.__posts.push([p, b]); return Promise.resolve({}); } };
      const _hubLoad = () => {};`, ['_hubRefresh']);
    await F._hubRefresh();
    expect(I.hubAsk).toBe(0);
  });
  it('the label reads Updating… while asking', () => {
    expect(HTML).toContain("I.hubAsk ? 'Updating…'");
  });
});
