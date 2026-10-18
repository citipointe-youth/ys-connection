import { describe, it, expect, vi, afterEach } from 'vitest';
import { busFixture } from './helpers/bus-fixtures';
import { loadFns } from './helpers/extract-fn';
import { makeBusController } from '../api/controllers/bus.controller';
import type { HttpRequest } from '../api/http/types';
import type { Actor } from '../core/entities/user';

// rel20 R19-L3 end to end: the real SPA poll (_busPollTick -> _busGet -> _busQs) and the real busRefresh
// talk to the real bus controller + service (memory repos). Trip logging on a non-bus-night day must poll
// GET /bus/run/version?date=<that day>, compare that day's version, and NOT refresh every 10 s tick.
afterEach(() => { vi.useRealTimers(); });

describe('rel20 R19-L3 e2e: Trip logging on another date', () => {
  it('polls ?date=, learns the version once, refreshes exactly once per real edit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 14, 19, 0)); // Wed 14 Oct 7pm local; bus night is Friday
    const f = await busFixture();
    await f.car('Big Bus', 8, ['L1']); // tonight's (Fri 16) run exists and has a version
    const ctl = makeBusController({ bus: f.svc });
    const actor = { id: 'u-jr', role: 'leader', displayName: 'Tom', grade: null, quad: null, leaderId: 'L1' } as unknown as Actor;
    const routes: Record<string, (r: HttpRequest) => Promise<unknown>> = {
      '/bus/run': ctl.run, '/bus/run/version': ctl.version, '/bus/my-car': ctl.myCar };
    const urls: string[] = [];
    const call = async (url: string) => {
      urls.push(url);
      const [path, qs] = url.split('?');
      const req = { ctx: actor, query: Object.fromEntries(new URLSearchParams(qs)), params: {}, body: undefined } as unknown as HttpRequest;
      return JSON.parse(JSON.stringify(await routes[path!]!(req)));
    };
    const spa = loadFns(['_busPollTick', '_busGet', '_busQs', '_busLocalNow', '_busToday', '_busTripDate', '_busTripQs', 'busRefresh'], `
      const S = { page: 'bus', user: { role: 'leader', leaderId: 'L1' } };
      const document = { hidden: false, getElementById: () => null };
      const BUS = { tab: 'mycar', tripDate: null, gen: 0, routeMin: {} };
      const API = { fresh: (u) => globalThis.__l3call(u) };
      let __renders = 0;
      function getMyLeaderId() { return 'L1'; } function _busEditing() { return false; }
      function renderBus() { __renders++; } function renderHome() {} function toast(m) { throw new Error(m); }
      function __s() { return { BUS, renders: __renders }; }`,
    ['_busPollTick', 'busRefresh', '__s']);
    (globalThis as any).__l3call = call;
    try {
      await spa.busRefresh(); // opening Bus: run view (tonight) + my car for the trip date (today, Wed)
      const st = spa.__s();
      expect(st.BUS.view.run.serviceDate).toBe('2026-10-16');
      expect(urls).toContain('/bus/my-car?now=2026-10-14T19%3A00&as=L1&date=2026-10-14');

      const poll = async () => { urls.length = 0; const r0 = spa.__s().renders; await spa._busPollTick(); await spa.__s().BUS.loading; return { urls: [...urls], refreshed: spa.__s().renders > r0 }; };
      // Tick 1 learns Wed's version; ticks 2-4 with no edit never refresh (no 10 s loop).
      for (let i = 0; i < 4; i++) {
        const t = await poll();
        expect(t.urls).toEqual(['/bus/run/version?now=2026-10-14T19%3A00&as=L1&date=2026-10-14']);
        expect(t.refreshed).toBe(false);
      }
      expect(spa.__s().BUS.tripVersion).toBe(0); // no Wed run yet; polling did not create one
      expect(await f.bus.getRunByDate('2026-10-14')).toBeNull();

      // Someone else logs a Wed trip: the next tick refreshes once, the one after does not.
      const other = { actor: { ...actor, id: 'u-2', leaderId: 'L2' }, asLeaderId: null, localNow: '2026-10-14T19:00', tripDate: '2026-10-14' };
      await f.svc.saveOwnCar(other as any, { car: { name: "Sarah's car", seats: 4, endsAt: 'last_drop' }, riderIds: [] });
      expect((await poll()).refreshed).toBe(true);
      expect((await poll()).refreshed).toBe(false);

      // An edit to tonight's run (a different date) does not refresh the Wed trip view.
      await f.car('Little Car', 4, ['L3']);
      expect((await poll()).refreshed).toBe(false);

      // Back on tonight's tab, the poll goes back to no date against BUS.version.
      spa.__s().BUS.tab = 'roster';
      const t = await poll();
      expect(t.urls).toEqual(['/bus/run/version?now=2026-10-14T19%3A00&as=L1']);
    } finally { delete (globalThis as any).__l3call; }
  });
});
