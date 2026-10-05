import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

describe('SPA bus helpers', () => {
  it('_busLocalNow formats phone local time', () => {
    const { _busLocalNow } = loadFns(['_busLocalNow']);
    expect(_busLocalNow(new Date(2026, 9, 9, 19, 5))).toBe('2026-10-09T19:05');
  });
  it('_busSuburb mirrors the server helper', () => {
    const { _busSuburb } = loadFns(['_busSuburb']);
    expect(_busSuburb('24 Wynnum Rd, Carina QLD 4152, Australia')).toBe('Carina');
  });
  it('_busDropAtIso rolls a pre-6am time onto the next calendar day', () => {
    const { _busDropAtIso } = loadFns(['_busDropAtIso'], "const BUS = { view: { run: { serviceDate: '2026-10-09' } } };");
    expect(new Date(_busDropAtIso('00:30')).getDate()).toBe(10);
    expect(new Date(_busDropAtIso('21:15')).getDate()).toBe(9);
  });
  it('module hooks exist and no emoji were introduced', () => {
    const html = loadIndexHtml();
    expect(html).toContain('/* ── BUS MODULE ── */');
    const block = html.slice(html.indexOf('/* ── BUS MODULE ── */'), html.indexOf('/* ── END BUS MODULE ── */'));
    expect(/\p{Extended_Pictographic}/u.test(block)).toBe(false);
  });
});

describe('maps links', () => {
  it('one link up to 9 stops; split above; ends follow the car', () => {
    const { _busMapsLinks } = loadFns(['_busMapsLinks']);
    const stops = Array.from({ length: 11 }, (_, i) => ({ address: `${i + 1} A St, Carina`, placeId: null }));
    const links = _busMapsLinks(stops, '1 Church Rd, Carindale', { endsAt: 'church' });
    expect(links.map((l: { label: string }) => l.label)).toEqual(['Stops 1–9', 'Stops 10–11']);
    expect(links[0].url).toContain('origin=1%20Church%20Rd');
    expect(links[1].url).toContain('destination=1%20Church%20Rd');
    const one = _busMapsLinks(stops.slice(0, 3), '1 Church Rd', { endsAt: 'last_drop' });
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe('Start in Google Maps');
    expect(one[0].url).toContain('destination=3%20A%20St');
  });
});

// Review fix round 1, finding 1: busRefresh() must share one in-flight fetch across concurrent
// callers (not fire a fresh /bus/run + /bus/my-car pair per caller), and must repaint whichever
// screen is actually showing Bus data exactly once per load, not once per caller.
describe('busRefresh concurrency (review fix round 1, finding 1)', () => {
  const mk = (page: string, fail = false) => {
    const prelude = `
      let __fetchCalls = 0;
      const BUS = { view: null, myCar: null, version: -1, loading: null, failed: false, gen: 0 };
      const S = { page: ${JSON.stringify(page)}, user: { id: 'u1' } };
      const calls = [];
      async function _busGet(path) {
        __fetchCalls++;
        await Promise.resolve(); // force a real async gap so concurrency is meaningful
        if (${fail}) throw new Error('boom');
        if (path === '/bus/run') return { run: { version: 7 } };
        return { ok: true };
      }
      function toast(m) { calls.push('toast:' + m); }
      function renderBus() { calls.push('renderBus'); }
      function renderHome() { calls.push('renderHome'); }
      function __state() { return { fetchCalls: __fetchCalls, calls, BUS }; }
    `;
    return loadFns(['busRefresh'], prelude, ['busRefresh', '__state']);
  };

  it('3 concurrent calls share one fetch pair and repaint once', async () => {
    const { busRefresh, __state } = mk('bus');
    await Promise.all([busRefresh(), busRefresh(), busRefresh()]);
    const st = __state();
    expect(st.fetchCalls).toBe(2); // one /bus/run + one /bus/my-car, not 6
    expect(st.calls.filter((c: string) => c === 'renderBus')).toHaveLength(1);
    expect(st.BUS.loading).toBeNull(); // cleared once the shared fetch settles
    expect(st.BUS.version).toBe(7);
  });

  it('repaints Home (not Bus) when that is the page actually showing', async () => {
    const { busRefresh, __state } = mk('home');
    await busRefresh();
    expect(__state().calls).toEqual(['renderHome']);
  });

  it('a failed load sets BUS.failed and still clears BUS.loading for the next attempt', async () => {
    const { busRefresh, __state } = mk('home', true);
    await busRefresh();
    const st = __state();
    expect(st.BUS.failed).toBe(true);
    expect(st.BUS.loading).toBeNull();
    expect(st.calls).toContain('renderHome');
  });
});

// Review fix round 2, finding 1: a busRefresh() fetch still in flight at logout must not write
// stale BUS.view/BUS.myCar from the previous session, and must not call renderHome()/renderBus()
// against the logged-out DOM (renderLogin() has already replaced #app, which has no #page-main —
// a stale renderHome() there throws). doLogout() bumps BUS.gen and resets S.user/S.page/BUS.view
// synchronously; busRefresh() captures gen at the start and re-checks it after the fetch settles.
describe('busRefresh ignores stale results after logout (review fix round 2, finding 1)', () => {
  const mk = () => {
    const prelude = `
      let __resolvers = [];
      const BUS = { view: null, myCar: null, version: -1, loading: null, failed: false, gen: 0 };
      const S = { page: 'home', user: { id: 'u1' } };
      const calls = [];
      function _busGet(path) {
        return new Promise((resolve) => {
          __resolvers.push(() => resolve(path === '/bus/run' ? { run: { version: 9 } } : { ok: true }));
        });
      }
      function toast(m) { calls.push('toast:' + m); }
      function renderBus() { calls.push('renderBus'); }
      function renderHome() { calls.push('renderHome'); }
      function __resolveAll() { const rs = __resolvers; __resolvers = []; rs.forEach((r) => r()); }
      // Mirrors the real doLogout()'s Bus-related lines: bump gen, reset state, log the user out.
      function __logout() { BUS.gen++; BUS.view = null; BUS.myCar = null; BUS.loading = null; BUS.failed = false; S.user = null; S.page = 'home'; }
      function __state() { return { calls, BUS, S }; }
    `;
    return loadFns(['busRefresh'], prelude, ['busRefresh', '__resolveAll', '__logout', '__state']);
  };

  it('a fetch still in flight at logout is dropped: no repaint, no stale BUS.view write', async () => {
    const { busRefresh, __resolveAll, __logout, __state } = mk();
    const pending = busRefresh(); // starts the fetch; _busGet's promises stay unresolved for now
    __logout(); // simulate logout happening before the in-flight fetch settles
    __resolveAll(); // now let the (now-stale) fetch resolve
    await pending;
    const st = __state();
    expect(st.calls).toEqual([]); // neither renderHome() nor renderBus() ran
    expect(st.BUS.view).toBeNull(); // the stale response did not get written
    expect(st.BUS.failed).toBe(false);
  });

  it('a fresh login after logout gets a normal, un-dropped refresh', async () => {
    const { busRefresh, __resolveAll, __logout, __state } = mk();
    const stalePending = busRefresh();
    __logout();
    __state().S.user = { id: 'u2' }; // simulate logging back in before the stale fetch settles
    // A new session starts before the stale fetch is resolved — same ordering as a quick
    // logout/login — and its own busRefresh() must behave completely normally.
    const freshPending = busRefresh();
    __resolveAll();
    await Promise.all([stalePending, freshPending]);
    const st = __state();
    expect(st.BUS.view).toEqual({ run: { version: 9 } });
    expect(st.calls.filter((c: string) => c === 'renderHome')).toHaveLength(1);
  });
});
