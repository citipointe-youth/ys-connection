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
      const BUS = { view: null, myCar: null, version: -1, loading: null, failed: false };
      const S = { page: ${JSON.stringify(page)} };
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
