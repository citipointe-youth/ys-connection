import { describe, it, expect } from 'vitest';
import { extractFn, loadFns, loadIndexHtml } from './helpers/extract-fn';
import { BUS_CAR_COLOURS } from '../services/bus-logic';

// BUS-1: the my-car / own-car calls carry ?date= from these helpers.
const TRIP = ['_busTripQs', '_busTripDate', '_busToday', '_busLocalNow'];

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
    const { _busDropAtIso } = loadFns(['_busDropAtIso', '_busTripDate', '_busToday', '_busLocalNow'], "const BUS = { tripDate: '2026-10-09', view: { run: { serviceDate: '2026-10-16' } } };");
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
    // My car (fromHere): no origin, so Google Maps starts from the phone and shows Start.
    const here = _busMapsLinks(stops.slice(0, 3), '1 Church Rd', { endsAt: 'church' }, 'PC', true);
    expect(here[0].url).not.toContain('origin');
    // Two kids at the same house → one stop.
    const sib = _busMapsLinks([{ address: '1 A St', placeId: 'PA' }, { address: '1 A St', placeId: 'PA' }, { address: '2 B St', placeId: 'PB' }], '1 Church Rd', { endsAt: 'church' }, 'PC', true);
    expect(new URL(sib[0].url).searchParams.get('waypoint_place_ids')).toBe('PA|PB');
  });
});

// Review fix round 1, finding 1: busRefresh() must share one in-flight fetch across concurrent
// callers (not fire a fresh /bus/run + /bus/my-car pair per caller), and must repaint whichever
// screen is actually showing Bus data exactly once per load, not once per caller.
describe('busRefresh concurrency (review fix round 1, finding 1)', () => {
  const mk = (page: string, fail = false) => {
    const prelude = `
      let __fetchCalls = 0;
      const BUS = { view: null, myCar: null, version: -1, loading: null, loadingAs: null, failed: false, gen: 0 };
      const S = { page: ${JSON.stringify(page)}, user: { id: 'u1' } };
      const calls = [];
      function getMyLeaderId() { return null; }
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
      function _busEditing() { return false; }
      function __state() { return { fetchCalls: __fetchCalls, calls, BUS }; }
    `;
    return loadFns(['busRefresh', ...TRIP], prelude, ['busRefresh', '__state']);
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
      const BUS = { view: null, myCar: null, version: -1, loading: null, loadingAs: null, failed: false, gen: 0 };
      const S = { page: 'home', user: { id: 'u1' } };
      const calls = [];
      function getMyLeaderId() { return null; }
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
    return loadFns(['busRefresh', ...TRIP], prelude, ['busRefresh', '__resolveAll', '__logout', '__state']);
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

// Task 4: busRefresh() deduped concurrent callers by returning the in-flight BUS.loading promise
// — but that promise was dispatched (captured getMyLeaderId() at its first await) under the OLD
// identity. Picking a new "I am" while a load is still in flight must not reattach to that stale
// fetch and show the old identity's car.
describe('busRefresh starts a fresh load when the identity changes mid-flight (Task 4)', () => {
  const mk = () => {
    const prelude = `
      let __resolvers = [];
      let __resolverCount = 0;
      let __as = 'L1';
      const BUS = { view: null, myCar: null, version: -1, loading: null, loadingAs: null, failed: false, gen: 0 };
      const S = { page: 'bus', user: { id: 'u1' } };
      const calls = [];
      function getMyLeaderId() { return __as; }
      function _busGet(path) {
        const as = __as; // captured synchronously at dispatch, same as the real _busQs()
        __resolverCount++;
        return new Promise((resolve) => {
          __resolvers.push(() => resolve(path === '/bus/my-car' ? { vehicle: { id: 'car-for-' + as } } : { run: { version: 7 } }));
        });
      }
      function toast(m) { calls.push('toast:' + m); }
      function renderBus() { calls.push('renderBus'); }
      function renderHome() { calls.push('renderHome'); }
      function _busEditing() { return false; }
      function __setAs(id) { __as = id; }
      function __resolveAll() { const rs = __resolvers; __resolvers = []; rs.forEach((r) => r()); }
      function __state() { return { calls, BUS, resolverCount: __resolverCount }; }
    `;
    return loadFns(['busRefresh', ...TRIP], prelude, ['busRefresh', '__setAs', '__resolveAll', '__state']);
  };

  it('a new "I am" chosen mid-load starts a fresh fetch instead of reattaching to the old one', async () => {
    const { busRefresh, __setAs, __resolveAll, __state } = mk();
    const staleLoad = busRefresh(); // dispatched while getMyLeaderId() returns 'L1'
    __setAs('L2'); // picks a new identity before the first load settles
    __state().BUS.myCar = null; // mirrors the real onchange handler's BUS.myCar = null
    const freshLoad = busRefresh();
    __resolveAll();
    await Promise.all([staleLoad, freshLoad]);
    // Both busRefresh() calls are async functions, so each returns its OWN promise wrapper
    // regardless — the real proof the second call didn't just reattach to the stale fetch is a
    // second /bus/run + /bus/my-car dispatch (4 resolvers total, not 2) landing L2's car.
    expect(__state().resolverCount).toBe(4);
    expect(__state().BUS.myCar).toEqual({ vehicle: { id: 'car-for-L2' } }); // L2's car, not the stale L1 fetch's
  });

  it('two calls under the SAME identity still share one in-flight fetch (no regression)', async () => {
    const { busRefresh, __resolveAll, __state } = mk();
    const a = busRefresh(), b = busRefresh();
    __resolveAll();
    await Promise.all([a, b]);
    expect(__state().resolverCount).toBe(2); // one /bus/run + one /bus/my-car, not two pairs
    expect(__state().BUS.myCar).toEqual({ vehicle: { id: 'car-for-L1' } });
  });
});

// C2: phoneLink feeds Bus walk-in names/phones (user-typed) into a double-quoted onclick
// attribute. Only stripping '/\\ (for the JS-string context) left a literal " free to break
// out of the attribute itself — e.g. a first name of a"onmouseover="... — so esc() must also
// run on both interpolated values.
describe('phoneLink escapes both interpolated values for the onclick attribute (C2)', () => {
  it('a name containing a double quote cannot break out of the onclick attribute', () => {
    const { phoneLink } = loadFns(['phoneLink', 'esc', 'fmtPhone']);
    const html = phoneLink('0412345678', 'a"onmouseover="alert(1)');
    const start = html.indexOf('onclick="') + 'onclick="'.length;
    const end = html.indexOf('"', start);
    const attrValue = html.slice(start, end);
    // Without esc(), the first literal " in the name closes the attribute early and the
    // captured value is truncated mid-string instead of running to the real closing ".
    expect(attrValue).toBe(`callPhone('0412345678','a&quot;onmouseover=&quot;alert(1)',false)`);
  });
});

// C1: on a failing load, busRefresh()'s finally used to clear BUS.loading, call renderBus(),
// which (seeing !BUS.view) called busRefresh() again — a hot loop hammering the DB pooler with
// a toast every time. renderBus() must show a retry card instead when BUS.failed is already
// set, and never call busRefresh() itself from that branch.
describe('renderBus shows a retry card instead of hot-looping busRefresh on a failing load (C1)', () => {
  it('a failing load settles once: the retry card renders, and busRefresh is not re-triggered', async () => {
    const prelude = `
      let __fetchCalls = 0;
      const BUS = { view: null, myCar: null, version: -1, loading: null, loadingAs: null, failed: false, gen: 0, pendingRepaint: false };
      const S = { page: 'bus', user: { id: 'u1' } };
      const appHtml = [];
      function getMyLeaderId() { return null; }
      async function _busGet(path) { __fetchCalls++; await Promise.resolve(); throw new Error('boom'); }
      function toast(m) {}
      function setApp(h) { appHtml.push(h); }
      function _busOn() { return true; }
      function _busEditing() { return false; }
      function esc(s) { return String(s); }
      function L(k) { return k; }
      function icEmpty(k) { return ''; }
      function renderHome() {}
      function __state() { return { fetchCalls: __fetchCalls, appHtml, BUS }; }
    `;
    const { renderBus, __state } = loadFns(['renderBus', 'busRefresh', ...TRIP], prelude, ['renderBus', '__state']);
    await renderBus();
    const st = __state();
    expect(st.fetchCalls).toBe(2); // one /bus/run + one /bus/my-car pair — not repeated
    expect(st.BUS.failed).toBe(true);
    expect(st.appHtml[st.appHtml.length - 1]).toContain('Retry');
  });
});

// I5: a background repaint must not steal focus from (and close the on-screen keyboard for) an
// input/textarea/select the leader is actively using, e.g. #bus-q — it defers the repaint via
// BUS.pendingRepaint instead.
describe('busRefresh skips the repaint while a field inside the page is focused (I5)', () => {
  const mk = () => {
    const prelude = `
      const BUS = { view: null, myCar: null, version: -1, loading: null, loadingAs: null, failed: false, gen: 0, pendingRepaint: false };
      const S = { page: 'bus', user: { id: 'u1' } };
      const calls = [];
      function getMyLeaderId() { return null; }
      let __active = null;
      const document = {
        getElementById: (id) => (id === 'page-main' ? { contains: (el) => el === __active } : null),
        get activeElement() { return __active; },
      };
      async function _busGet(path) { return path === '/bus/run' ? { run: { version: 7 } } : { ok: true }; }
      function toast(m) {}
      function renderBus() { calls.push('renderBus'); }
      function renderHome() { calls.push('renderHome'); }
      function __setActive(tag, type) { __active = tag ? { tagName: tag, type: type || '' } : null; }
      function __state() { return { calls, BUS }; }
    `;
    return loadFns(['busRefresh', '_busEditing', ...TRIP], prelude, ['busRefresh', '__setActive', '__state']);
  };

  it('repaints normally when nothing is focused', async () => {
    const { busRefresh, __state } = mk();
    await busRefresh();
    const st = __state();
    expect(st.calls).toEqual(['renderBus']);
    expect(st.BUS.pendingRepaint).toBe(false);
  });

  it('defers the repaint and flags pendingRepaint while an input inside the page is focused', async () => {
    const { busRefresh, __setActive, __state } = mk();
    __setActive('INPUT');
    await busRefresh();
    const st = __state();
    expect(st.calls).toEqual([]);
    expect(st.BUS.pendingRepaint).toBe(true);
    expect(st.BUS.view).toEqual({ run: { version: 7 } }); // data still refreshed, just not painted
  });

  it('a focused checkbox or radio does not count as editing', async () => {
    for (const type of ['checkbox', 'radio']) {
      const { busRefresh, __setActive, __state } = mk();
      __setActive('INPUT', type);
      await busRefresh();
      expect(__state().calls).toEqual(['renderBus']);
    }
  });
});

// M3: a cancelled New Person sheet must not leave a stale gender pick for the next one.
describe('busNewPerson resets a stale gender selection (M3)', () => {
  it('always resets _busNpGender, regardless of what the previous sheet left behind', () => {
    const prelude = `
      const BUS = { search: 'Jamie' };
      let _busNpGender = 'female';
      function modal(h) {}
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function _gradeList() { return [7, 8, 9, 10, 11, 12]; }
      function _gradeWord() { return 'Year'; }
      function _busAddressPicker() { return ''; }
      function __state() { return { _busNpGender }; }
    `;
    const { busNewPerson, __state } = loadFns(['busNewPerson'], prelude, ['busNewPerson', '__state']);
    busNewPerson();
    expect(__state()._busNpGender).toBeNull();
  });
});

// Leaders on <car> sheet: the search hides rows but never unticks them, so Save still sends
// every checked leader, including ones filtered out of view.
describe('busEditCarLeaders search filter', () => {
  it('hides non-matching rows case-insensitively and still saves hidden checked leaders', async () => {
    const prelude = `
      const mkRow = (name, id, checked) => ({ dataset: { name }, style: { display: '' }, input: { value: id, checked } });
      const rows = [mkRow('amy lee', 'L1', true), mkRow('bob ray', 'L2', true), mkRow('cara amy', 'L3', false)];
      const __sends = [];
      const document = { querySelectorAll: (sel) => sel === '#rvl-leaders .cbx-row' ? rows
        : sel === '#rvl-leaders input:checked' ? rows.map((r) => r.input).filter((i) => i.checked) : [] };
      async function _busSend(method, path, body) { __sends.push({ method, path, body }); }
      function closeModal() {}
      function toast() {}
      function __state() { return { rows, sends: __sends }; }
    `;
    const { _busFilterChecks, busSaveCarLeaders, __state } = loadFns(['_busFilterChecks', 'busSaveCarLeaders'], prelude, ['_busFilterChecks', 'busSaveCarLeaders', '__state']);
    _busFilterChecks('rvl-leaders', '  AMY ');
    expect(__state().rows.map((r: any) => r.style.display)).toEqual(['', 'none', '']);
    await busSaveCarLeaders('rv1');
    expect(__state().sends[0]).toEqual({ method: 'PATCH', path: '/bus/run/vehicles/rv1', body: { leaderIds: ['L1', 'L2'] } });
    _busFilterChecks('rvl-leaders', '');
    expect(__state().rows.every((r: any) => r.style.display === '')).toBe(true);
  });
  it('renders a search box and fills the sheet height', () => {
    const html = loadIndexHtml();
    expect(html).toContain('placeholder="Search leaders"');
    expect(html).toMatch(/\.mo-box\.bus-fill > \.bus-checks\{[^}]*max-height:none/);
  });
});

describe('SPA escaping (final re-review)', () => {
  it('declares esc() exactly once, so the quote-escaping version is the one bound at runtime', () => {
    expect(loadIndexHtml().match(/function esc\(/g)).toHaveLength(1);
  });
  it('_busAddressPicker shows the suburb from /bus/search results', () => {
    const prelude = 'const BUS = { ac: {} }; const window = {};';
    const { _busAddressPicker } = loadFns(['_busAddressPicker', '_busAddrLabel', '_busSuburb', 'esc', '_busAcField', '_busUuid'], prelude);
    expect(_busAddressPicker([{ id: 'a1', label: 'Home', suburb: 'Carina' }])).toContain('Home · Carina');
  });
  it('_busAddressPicker falls back to the street when the saved address has no label', () => {
    const prelude = 'const BUS = { ac: {} }; const window = {};';
    const { _busAddressPicker } = loadFns(['_busAddressPicker', '_busAddrLabel', '_busSuburb', 'esc', '_busAcField', '_busUuid'], prelude);
    expect(_busAddressPicker([{ id: 'a1', label: '', street: '3 Lindsay Court', suburb: 'Cornubia' }])).toContain('3 Lindsay Court · Cornubia');
  });
  it('BUS-1 B6: a saved label is escaped once (picker and trip sheet), not twice', () => {
    const prelude = 'const BUS = { ac: {} }; const window = {};';
    const f = loadFns(['_busAddressPicker', '_busAddrLabel', '_busSuburb', 'esc', '_busAcField', '_busUuid'], prelude);
    expect(f._busAddrLabel({ label: "Mum's", suburb: 'Carina' })).toBe("Mum's · Carina");
    const html = f._busAddressPicker([{ id: 'a1', label: "<b>Mum's</b>", suburb: 'Carina' }]);
    expect(html).toContain('&lt;b&gt;Mum&#39;s&lt;/b&gt; · Carina');
    expect(html).not.toContain('&amp;');
  });
  it('BUS-1 B6: a typed but unpicked end address is saved (not blocked) and the leader is told', () => {
    const save = extractFn(loadIndexHtml(), 'busSaveOwnCar');
    expect(save).toContain("No address picked — ends at last drop");
    expect(save).not.toMatch(/Pick the address from the suggestions list/);
  });
});

describe('R2 SPA helpers', () => {
  it('_busAcResolve keeps the place ID only while the text is the picked suggestion', () => {
    const { _busAcResolve } = loadFns(['_busAcResolve']);
    const st = { text: '24 Wynnum Rd, Carina', placeId: 'P1' };
    expect(_busAcResolve(st, ' 24 Wynnum Rd, Carina ')).toBe('P1');
    expect(_busAcResolve(st, '24 Wynnum Rd, Carina East')).toBeNull();
    expect(_busAcResolve(undefined, 'x')).toBeNull();
  });
  it('_busFitCount counts unplaced, unpinned riders that have a map pin', () => {
    const { _busFitCount } = loadFns(['_busFitCount']);
    const v = { riders: [
      { runVehicleId: null, pinned: false, placeId: 'P' }, { runVehicleId: null, pinned: true, placeId: 'P' },
      { runVehicleId: null, pinned: false, placeId: null }, { runVehicleId: 'c', pinned: false, placeId: 'P' }] };
    expect(_busFitCount(v)).toBe(1);
  });
  it('_busLockedBy names the holder only while the lock is live and not our own generate', () => {
    const { _busLockedBy } = loadFns(['_busLockedBy']);
    const now = Date.parse('2026-10-09T09:00:00.000Z');
    const v = (until: string | null) => ({ run: { lockBy: 'Sarah', lockUntil: until } });
    expect(_busLockedBy(v('2026-10-09T09:00:20.000Z'), now, false)).toBe('Sarah');
    expect(_busLockedBy(v('2026-10-09T08:59:59.000Z'), now, false)).toBeNull();
    expect(_busLockedBy(v('2026-10-09T09:00:20.000Z'), now, true)).toBeNull();
    expect(_busLockedBy(v(null), now, false)).toBeNull();
  });
  it('Maps links carry origin/destination/waypoint place IDs', () => {
    const { _busMapsLinks } = loadFns(['_busMapsLinks']);
    const stops = [{ address: '1 A St', placeId: 'PA' }, { address: '2 B St', placeId: 'PB' }];
    const u = new URL(_busMapsLinks(stops, '1 Church Rd', { endsAt: 'church' }, 'PC')[0].url);
    expect([u.searchParams.get('origin_place_id'), u.searchParams.get('destination_place_id'), u.searchParams.get('waypoint_place_ids')])
      .toEqual(['PC', 'PC', 'PA|PB']);
    const d = new URL(_busMapsLinks(stops, '1 Church Rd', { endsAt: 'last_drop' }, 'PC')[0].url);
    expect([d.searchParams.get('destination_place_id'), d.searchParams.get('waypoint_place_ids')]).toEqual(['PB', 'PA']);
    const e = new URL(_busMapsLinks(stops, '1 Church Rd', { endsAt: 'address', endsAddress: '9 End St', endsPlaceId: 'PE' }, 'PC')[0].url);
    expect(e.searchParams.get('destination_place_id')).toBe('PE');
  });
});

describe('R3 SPA', () => {
  it('server and SPA car colours match (the static map paints routes in them)', () => {
    const m = /const BUS_CAR_COLOURS = (\[[^\]]*\]);/.exec(loadIndexHtml())!;
    expect(JSON.parse(m[1]!.replace(/'/g, '"'))).toEqual(BUS_CAR_COLOURS);
  });
  it('_busPickTab keeps Route analysis for seesAnalysis and Past for seesPast (2026-10-15)', () => {
    const { _busPickTab } = loadFns(['_busPickTab']);
    expect(_busPickTab(['routes', 'mycar'], 'analysis', false, true)).toBe('analysis');
    expect(_busPickTab(['routes', 'mycar'], 'analysis', true, false)).toBe('routes');
    expect(_busPickTab(['routes', 'mycar'], 'past', false, true)).toBe('routes');
    expect(_busPickTab(['routes', 'mycar'], 'past', true, true)).toBe('past');
    expect(_busPickTab(['routes', 'mycar'], 'mycar', false, false)).toBe('mycar');
  });
  it('_busExtraLine reads as a plain sentence with no symbols', () => {
    const { _busExtraLine } = loadFns(['_busExtraLine']);
    expect(_busExtraLine({ count: 1, seats: 8, before: { longestMin: 52, totalMin: 150, unassigned: 2 }, after: { longestMin: 38, totalMin: 160, unassigned: 0 } }))
      .toBe('+1 car, 8 seats: longest drive 38 min (now 52) · unassigned 0 (now 2)');
  });
});

// 2026-10-06 round-2 fixes: unpin, lone-girl warning, stale routeMin after a move, locked
// roster edits while Generate is running, and a timed-out/401-aware map load.
describe('busMoveSheet offers Unpin only for a pinned rider', () => {
  const mk = (pinned: boolean) => {
    const prelude = `
      const BUS = { view: { riders: [{ id: 'r1', name: 'Amy', gender: 'female', pinned: ${pinned} }], vehicles: [] } };
      function esc(s) { return String(s); }
      function _busCarColour(i) { return '#000'; }
      let __captured = '';
      function modal(h) { __captured = h; }
      function __state() { return { captured: __captured }; }
    `;
    return loadFns(['busMoveSheet'], prelude, ['busMoveSheet', '__state']);
  };
  it('shows the Unpin row for a pinned rider', () => {
    const { busMoveSheet, __state } = mk(true);
    busMoveSheet('r1');
    expect(__state().captured).toContain('Unpin — let Generate place them');
    expect(__state().captured).toContain("busUnpin('r1')");
  });
  it('omits the Unpin row for an unpinned rider', () => {
    const { busMoveSheet, __state } = mk(false);
    busMoveSheet('r1');
    expect(__state().captured).not.toContain('Unpin');
  });
});

describe('busMove / busUnpin clear stale routeMin entries for the affected cars', () => {
  const mk = () => {
    const prelude = `
      const BUS = { view: { riders: [{ id: 'r1', runVehicleId: 'carA' }] }, routeMin: { carA: 10, carB: 20 } };
      const __calls = [];
      async function _busSend(method, path, body) { __calls.push({ method, path, body }); }
      function closeModal() {}
      function toast() {}
      function __state() { return { BUS, calls: __calls }; }
    `;
    return loadFns(['busMove', 'busUnpin', '_busClearRouteMin'], prelude, ['busMove', 'busUnpin', '__state']);
  };
  it('busMove clears routeMin for both the old and the new car', async () => {
    const { busMove, __state } = mk();
    await busMove('r1', 'carB');
    const st = __state();
    expect(st.BUS.routeMin.carA).toBeUndefined();
    expect(st.BUS.routeMin.carB).toBeUndefined();
    expect(st.calls[0]).toEqual({ method: 'POST', path: '/bus/riders/r1/move', body: { runVehicleId: 'carB' } });
  });
  it('busUnpin sends { unpin: true } and clears routeMin for the rider\'s current car', async () => {
    const { busUnpin, __state } = mk();
    await busUnpin('r1');
    const st = __state();
    expect(st.BUS.routeMin.carA).toBeUndefined();
    expect(st.calls[0]).toEqual({ method: 'POST', path: '/bus/riders/r1/move', body: { unpin: true } });
  });
});

describe('_busRoutesHtml flags a car with exactly one unaccompanied girl', () => {
  const mkStubs = `
    function esc(s) { return String(s); }
    function icS(k) { return k; }
    function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; }
    function _busConsentChip() { return ''; }
    function _busPinChip() { return ''; }
    function _busCarColour() { return '#000'; }
    function _busPinnedIcon() { return ''; }
    function _busRoutesHead() { return ''; }
    function _busUndoBar() { return ''; }
  `;
  const car = (over: any = {}) => ({ id: 'rv1', name: 'Van A', vehicleId: 'v1', running: true, colourIndex: 0, capacity: 4, leaderNames: [],
    eligibility: { female: true, male: true, unknown: false }, ...over });
  it('shows "No female leader" when the server flags the car', () => {
    const v = { run: { readOnly: false }, riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P1' }],
      vehicles: [car({ needsFemaleLeader: true })] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml', '_busBusChips', '_busGradeChip'], `${mkStubs}
const BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    expect(_busRoutesHtml()).toContain('No female leader');
  });
  it('does not show it when the car is not flagged', () => {
    const v = { run: { readOnly: false }, riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P1' }],
      vehicles: [car({ needsFemaleLeader: false })] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml', '_busBusChips', '_busGradeChip'], `${mkStubs}
const BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    expect(_busRoutesHtml()).not.toContain('No female leader');
  });
  it('shows the per-car Route button only for a car with riders', () => {
    const v = { run: { readOnly: false }, riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'male', placeId: 'P1' }],
      vehicles: [car(), { ...car(), id: 'rv2' }] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml', '_busBusChips', '_busGradeChip'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    const html = _busRoutesHtml();
    expect(html).toContain("busOpenCarRoute('rv1')");
    expect(html).not.toContain("busOpenCarRoute('rv2')");
  });
});

describe('busGenerate toast mentions girls needing a female leader', () => {
  it('includes the noFemaleLeader count when > 0', async () => {
    const prelude = `
      const BUS = { generating: false };
      function closeModal() {}
      function renderBus() {}
      let __msg = null;
      function toast(m) { __msg = m; }
      function _busQs() { return ''; }
      async function busRefresh() {}
      const API = { post: async () => ({ noFemaleLeader: 2, unassigned: 0, noAddressPin: 0 }) };
      function __state() { return { msg: __msg }; }
    `;
    const { busGenerate, __state } = loadFns(['busGenerate'], prelude, ['busGenerate', '__state']);
    await busGenerate('all');
    expect(__state().msg).toContain('2 girls need a car with a female leader');
  });
  it('omits the note when noFemaleLeader is 0', async () => {
    const prelude = `
      const BUS = { generating: false };
      function closeModal() {}
      function renderBus() {}
      let __msg = null;
      function toast(m) { __msg = m; }
      function _busQs() { return ''; }
      async function busRefresh() {}
      const API = { post: async () => ({ noFemaleLeader: 0, unassigned: 0, noAddressPin: 0 }) };
      function __state() { return { msg: __msg }; }
    `;
    const { busGenerate, __state } = loadFns(['busGenerate'], prelude, ['busGenerate', '__state']);
    await busGenerate('all');
    expect(__state().msg).toBe('Routes ready');
  });
});

// Task 13: Generate (ours or another device's lock) must not hide the whole search UI —
// only readOnly (a finished run) does. Remove stays hidden while a write would be blocked
// (simplest call, and matches the prior pre-Task-13 behaviour for that one button).
describe('N01 _busRosterHtml sorts tonight riders girls first, then grade ascending, then name', () => {
  it('orders female before male (the app Girls/Boys order), grade up, unknown gender/grade last', () => {
    const stubs = `function esc(s) { return String(s); } function icS() { return ''; } function icEmpty() { return ''; }
     function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; } function _busConsentChip() { return ''; } function _busPinChip() { return ''; } function _busCarColour() { return '#000'; }
     function _busHitsHtml() { return ''; } function _busPastHtml() { return ''; } function _busGradeChip() { return ''; }`;
    const riders = [
      { id: 'a', name: 'Zed', gender: 'male', grade: 7 }, { id: 'b', name: 'Amy', gender: 'female', grade: 11 },
      { id: 'c', name: 'Bob', gender: 'male', grade: null }, { id: 'd', name: 'Cat', gender: 'female', grade: 8 },
      { id: 'e', name: 'Al', gender: null, grade: 7 }, { id: 'f', name: 'Ben', gender: 'male', grade: 7 }];
    const prelude = `${stubs}
      const BUS = { search: '', generating: false, view: { run: { readOnly: false, lockBy: null, lockUntil: null }, riders: ${JSON.stringify(riders)}, vehicles: [] } };`;
    const { _busRosterHtml } = loadFns(['_busRosterHtml', '_busLockedBy'], prelude, ['_busRosterHtml']);
    const ids = [..._busRosterHtml().matchAll(/busEditRider\('(\w)'\)/g)].map((m) => m[1]);
    expect(ids).toEqual(['d', 'b', 'f', 'a', 'c', 'e']);
  });
});

describe('_busRosterHtml keeps search/Past riders visible during Generate; only readOnly hides them', () => {
  const stubs = `function esc(s) { return String(s); } function icS() { return ''; } function icEmpty() { return ''; }
     function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; } function _busConsentChip() { return ''; } function _busPinChip() { return ''; } function _busCarColour() { return '#000'; }
     function _busHitsHtml() { return ''; } function _busPastHtml() { return ''; }`;
  const run = (readOnly: boolean, generating: boolean, lockBy: string | null, lockUntil: string | null) => {
    const prelude = `${stubs}
      const BUS = { search: '', generating: ${generating},
        view: { run: { readOnly: ${readOnly}, lockBy: ${JSON.stringify(lockBy)}, lockUntil: ${JSON.stringify(lockUntil)} },
          riders: [{ id: 'r1', name: 'Amy' }], vehicles: [] } };`;
    const { _busRosterHtml } = loadFns(['_busRosterHtml', '_busLockedBy', '_busGradeChip'], prelude, ['_busRosterHtml']);
    return _busRosterHtml();
  };
  it('shows the search bar and remove button when nothing is blocking', () => {
    const html = run(false, false, null, null);
    expect(html).toContain('bus-q');
    expect(html).toContain('busConfirmRemove');
  });
  it('keeps the search bar visible while BUS.generating is true, but hides Remove', () => {
    const html = run(false, true, null, null);
    expect(html).toContain('bus-q');
    expect(html).not.toContain('busConfirmRemove');
  });
  it('keeps the search bar visible while another coordinator holds a live lock, but hides Remove', () => {
    const html = run(false, false, 'Sarah', '2099-01-01T00:00:00.000Z');
    expect(html).toContain('bus-q');
    expect(html).not.toContain('busConfirmRemove');
  });
  it('hides the search bar entirely once the run is readOnly (finished)', () => {
    const html = run(true, false, null, null);
    expect(html).not.toContain('bus-q');
    expect(html).not.toContain('busConfirmRemove');
  });
});

describe('_busBlockWrite toasts and blocks only while Generate/lock is active (Task 13)', () => {
  const mk = (generating: boolean, lockBy: string | null, lockUntil: string | null) => {
    const prelude = `
      const BUS = { generating: ${generating}, view: { run: { lockBy: ${JSON.stringify(lockBy)}, lockUntil: ${JSON.stringify(lockUntil)} } } };
      let __msg = null;
      function toast(m) { __msg = m; }
      function __state() { return { msg: __msg }; }
    `;
    return loadFns(['_busBlockWrite', '_busGenLocked', '_busLockedBy'], prelude, ['_busBlockWrite', '__state']);
  };
  it('blocks and toasts while BUS.generating is true', () => {
    const { _busBlockWrite, __state } = mk(true, null, null);
    expect(_busBlockWrite()).toBe(true);
    expect(__state().msg).toBe('Routes are being generated — try again in a moment');
  });
  it('blocks while another device holds a live lock', () => {
    const { _busBlockWrite } = mk(false, 'Sarah', '2099-01-01T00:00:00.000Z');
    expect(_busBlockWrite()).toBe(true);
  });
  it('does not block when nothing is generating/locked', () => {
    const { _busBlockWrite, __state } = mk(false, null, null);
    expect(_busBlockWrite()).toBe(false);
    expect(__state().msg).toBeNull();
  });
});

// Bug fix (2026-10-06 follow-up): My car's picker used to re-render off the stale BUS.myCar
// fetched before any identity was chosen ("No car assigned."). Task B (owner, 2026-10-08):
// changing identity now does a full page reload (_busIdentityChanged) instead of a bare
// busRefresh()/renderBus(), so the app reopens on Bus → My car with the fresh identity.
describe('_busMyCarHtml identity picker goes through _busIdentityChanged', () => {
  it('choosing a name calls _busIdentityChanged with the picked value', () => {
    const prelude = `
      const BUS = { view: { leaders: [{ id: 'L1', name: 'Amy' }] }, myCar: null };
      function getMyLeaderId() { return null; }
      function esc(s) { return String(s); }
    `;
    const { _busMyCarHtml } = loadFns(['_busMyCarHtml', 'progBar', ...TRIP], prelude);
    const html = _busMyCarHtml();
    expect(html).toContain('_busIdentityChanged(this.value)');
    expect(html).not.toContain('renderBus()');
    expect(html).not.toContain('busRefresh()');
  });
  it('"Not you?" calls _busIdentityChanged(null)', () => {
    const prelude = `
      const BUS = { view: { leaders: [{ id: 'L1', name: 'Amy' }] }, myCar: null };
      function getMyLeaderId() { return 'L1'; }
      function esc(s) { return String(s); }
    `;
    const { _busMyCarHtml } = loadFns(['_busMyCarHtml', 'progBar', ...TRIP], prelude);
    const html = _busMyCarHtml();
    expect(html).toContain('_busIdentityChanged(null)');
    expect(html).not.toContain('renderBus()');
    expect(html).not.toContain('busRefresh()');
  });
});

// BUS-1 (operator 2026-10-18): "I am" is remembered WITHOUT a page reload.
describe('_busIdentityChanged (BUS-1: no reload)', () => {
  it('persists the id, clears my car + draft, refreshes and repaints; never reloads', () => {
    const prelude = `
      const BUS = { myCar: { x: 1 }, ocDraft: { y: 1 } };
      let __setId, __refreshed = 0, __rendered = 0, __reloaded = false;
      const location = { reload: () => { __reloaded = true; } };
      function setMyLeaderId(id) { __setId = id; }
      function busRefresh() { __refreshed++; return Promise.resolve(); }
      function renderBus() { __rendered++; }
      function __state() { return { setId: __setId, refreshed: __refreshed, rendered: __rendered, reloaded: __reloaded, bus: BUS }; }
    `;
    const { _busIdentityChanged, __state } = loadFns(['_busIdentityChanged'], prelude, ['_busIdentityChanged', '__state']);
    _busIdentityChanged('L2');
    const s = __state();
    expect([s.setId, s.refreshed, s.rendered, s.reloaded, s.bus.myCar, s.bus.ocDraft]).toEqual(['L2', 1, 1, false, null, null]);
  });
  it('a null id clears the leader', () => {
    const prelude = `const BUS = {}; let __setId = 'unset'; function setMyLeaderId(id) { __setId = id; }
      function busRefresh() {} function renderBus() {} function __state() { return { setId: __setId }; }`;
    const { _busIdentityChanged, __state } = loadFns(['_busIdentityChanged'], prelude, ['_busIdentityChanged', '__state']);
    _busIdentityChanged(null);
    expect(__state().setId).toBeNull();
  });
  it('index.html no longer uses the yap_bus_reload flag', () => { expect(loadIndexHtml()).not.toContain('yap_bus_reload'); });
});

// Leader preferred grades (Task 2): Edit Pool sheet gets a per-leader grade checkbox block
// (same #ve-grades pattern busEditVehicle uses), and the pool list shows a compact chip.
describe('leader preferred grades UI', () => {
  it('busEditPoolSheet renders a checked box for each of a leader\'s prefGrades, scoped by leader id', () => {
    const prelude = `
      const BUS = { view: { leaders: [{ id: 'L1', name: 'Amy', gender: 'female', inPool: true, prefGrades: [9, 10] }] } };
      function esc(s) { return String(s); }
      function icS() { return ''; }
      function _gradeList() { return [7, 8, 9, 10, 11, 12]; }
      function _gradeWord() { return 'Year'; }
      let __captured = '';
      function modal(h) { __captured = h; }
      function __state() { return { captured: __captured }; }
    `;
    const { busEditPoolSheet, __state } = loadFns(['busEditPoolSheet'], prelude, ['busEditPoolSheet', '__state']);
    busEditPoolSheet();
    const html = __state().captured;
    expect(html).toContain('id="pg-L1"');
    expect(html).toMatch(/value="9"[^>]*checked/);
    expect(html).toMatch(/value="10"[^>]*checked/);
    expect(html).not.toMatch(/value="7"[^>]*checked/);
  });
  it('busSetLeaderGrades reads only the checked boxes inside this leader\'s own block', async () => {
    const prelude = `
      const __calls = [];
      const document = { querySelectorAll: (sel) => (sel === '#pg-L1 input:checked' ? [{ value: '9' }, { value: '11' }] : []) };
      async function _busSend(method, path, body) { __calls.push({ method, path, body }); }
      function busEditPoolSheet() {}
      function toast() {}
      function __state() { return { calls: __calls }; }
    `;
    const { busSetLeaderGrades, __state } = loadFns(['busSetLeaderGrades'], prelude, ['busSetLeaderGrades', '__state']);
    await busSetLeaderGrades('L1');
    expect(__state().calls[0]).toEqual({ method: 'PATCH', path: '/bus/leader-prefs/L1', body: { prefGrades: [9, 11] } });
  });
  it('_busPrefGradesChip is compact and empty when there are no preferred grades', () => {
    const { _busPrefGradesChip } = loadFns(['_busPrefGradesChip']);
    expect(_busPrefGradesChip({ prefGrades: [9, 10] })).toContain('Y9,Y10');
    expect(_busPrefGradesChip({ prefGrades: [] })).toBe('');
  });
});

// Route preview per car (Task 3): reuses My car's own _busMapsLinks helper; hidden for an
// empty car; opens directly for a single link, offers a small sheet for several.
describe('busOpenCarRoute', () => {
  const mk = (riders: unknown[]) => {
    const prelude = `
      const BUS = { view: { vehicles: [{ id: 'rv1', name: 'Van A', endsAt: 'church' }], riders: ${JSON.stringify(riders)} },
        myCar: { churchAddress: '1 Church Rd', churchPlaceId: 'PC' } };
      let __opened = null, __modal = null;
      const window = { open: (url) => { __opened = url; } };
      function esc(s) { return String(s); }
      function icS() { return ''; }
      function toast() {}
      function modal(h) { __modal = h; }
      function __state() { return { opened: __opened, modalHtml: __modal }; }
    `;
    return loadFns(['busOpenCarRoute', '_busMapsLinks'], prelude, ['busOpenCarRoute', '__state']);
  };
  it('opens Google Maps directly for a car with a single link (<=9 stops)', () => {
    const { busOpenCarRoute, __state } = mk([{ id: 'r1', runVehicleId: 'rv1', stopOrder: 1, address: '1 A St', placeId: 'PA' }]);
    busOpenCarRoute('rv1');
    expect(__state().opened).toContain('google.com/maps/dir');
    expect(__state().modalHtml).toBeNull();
  });
  it('offers a small sheet of links for more than 9 stops, wrapped in a plain div (Task 1 bug fix)', () => {
    const riders = Array.from({ length: 11 }, (_, i) => ({ id: 'r' + i, runVehicleId: 'rv1', stopOrder: i + 1, address: `${i} A St`, placeId: 'P' + i }));
    const { busOpenCarRoute, __state } = mk(riders);
    busOpenCarRoute('rv1');
    expect(__state().opened).toBeNull();
    expect(__state().modalHtml).toContain('Van A route');
    expect((__state().modalHtml.match(/btn-primary btn-full/g) ?? []).length).toBe(2);
    // The links must not be direct children of .mo-box — the app-wide sticky rule
    // `.mo-box > .btn-primary.btn-full` would stack every one of them on top of the other.
    expect(__state().modalHtml).toMatch(/<div>\s*<a class="btn btn-primary btn-full"/);
  });
  it('does nothing for a car with no riders', () => {
    const { busOpenCarRoute, __state } = mk([]);
    busOpenCarRoute('rv1');
    expect(__state().opened).toBeNull();
    expect(__state().modalHtml).toBeNull();
  });
});

// Task 1: BUS.myCar being null just means it hasn't loaded yet — don't send the leader to a
// setting that's actually fine. Only the genuinely-empty case says to fix Bus settings.
describe('busOpenCarRoute toast wording distinguishes "still loading" from "really not set" (Task 1)', () => {
  const mkToast = (myCar: unknown) => {
    const prelude = `
      const BUS = { view: { vehicles: [{ id: 'rv1', name: 'Van A', endsAt: 'church' }], riders: [{ id: 'r1', runVehicleId: 'rv1', stopOrder: 1, address: '1 A St', placeId: 'PA' }] },
        myCar: ${JSON.stringify(myCar)} };
      let __msg = null;
      function esc(s) { return String(s); }
      function icS() { return ''; }
      function toast(m) { __msg = m; }
      function modal() {}
      const window = { open: () => {} };
      const S = { user: { role: 'admin' } };
      function __state() { return { msg: __msg }; }
    `;
    return loadFns(['busOpenCarRoute', '_busMapsLinks'], prelude, ['busOpenCarRoute', '__state']);
  };
  it('says "still loading" when BUS.myCar has not loaded yet', () => {
    const { busOpenCarRoute, __state } = mkToast(null);
    busOpenCarRoute('rv1');
    expect(__state().msg).toBe('Still loading — try again in a moment');
  });
  it('says to set the church address once loaded and genuinely empty', () => {
    const { busOpenCarRoute, __state } = mkToast({ churchAddress: '' });
    busOpenCarRoute('rv1');
    expect(__state().msg).toBe('Set the church address in Bus settings');
  });
});

describe('_busLoadMap times out and handles an expired session (2026-10-06)', () => {
  it('passes an AbortSignal and calls _handleAuthExpired on a 401', async () => {
    const prelude = `
      function _busQs() { return ''; }
      const API = { token: 'tok' };
      let __handled = false;
      function _handleAuthExpired() { __handled = true; }
      const BUS = { version: 1, tab: 'analysis', mapUrl: null };
      const S = { page: 'bus' };
      function renderBus() {}
      let __fetchOpts = null;
      async function fetch(url, opts) { __fetchOpts = opts; return { status: 401, ok: false }; }
      function __state() { return { handled: __handled, fetchOpts: __fetchOpts, BUS }; }
    `;
    const { _busLoadMap, __state } = loadFns(['_busLoadMap'], prelude, ['_busLoadMap', '__state']);
    await _busLoadMap();
    const st = __state();
    expect(st.handled).toBe(true);
    expect(st.fetchOpts.signal).toBeInstanceOf(AbortSignal);
    expect(st.BUS.mapUrl).toBe('');
  });
});

describe('Past riders (Tonight tab)', () => {
  const stubs = `function esc(s) { return String(s); }\nfunction icS(k) { return k; }`;
  const past = [{ studentId: 's1', guestId: null, addressId: 'a1', name: 'Jess Tran', grade: 9, suburb: 'Carina' }];
  it('renders collapsed by default with a count, and nothing when locked or empty', () => {
    const load = (pastRiders: unknown[], open = false) => loadFns(['_busPastHtml'],
      `${stubs}\nconst BUS = { view: { pastRiders: ${JSON.stringify(pastRiders)} }, pastOpen: ${open} };`)._busPastHtml;
    const html = load(past)(false);
    expect(html).toContain('Past riders (1)');
    expect(html).toContain('class="card drop"');
    expect(html).toContain('busAddPast(0)');
    expect(load(past, true)(false)).toContain('class="card drop open"');
    expect(load(past)(true)).toBe('');
    expect(load([])(false)).toBe('');
  });
  it('a tap opens a confirm sheet with last-used address first; Add posts the chosen address', async () => {
    const sent: unknown[] = [];
    const { busAddPast, busSavePast, __html } = loadFns(['busAddPast', 'busSavePast'], `const BUS = { view: { pastRiders: ${JSON.stringify(past)} } };
      let __m = '';
      function _busBlockWrite() { return false; }
      async function _busGet(path, q) { globalThis.__sent.push(['GET', path, q]); return [{ id: 'a2', label: 'Dad' }, { id: 'a1', label: 'Mum' }]; }
      function _busAddressPicker(addrs) { return addrs.map((a) => a.id).join(','); }
      function _busReadAddress() { return { addressId: 'a1' }; }
      function esc(s) { return String(s); }
      function modal(h) { __m = h; } function closeModal() {}
      async function _busSend(m, url, body) { globalThis.__sent.push([m, url, body]); }
      function toast() {} function renderBus() {}
      function __html() { return __m; }`, ['busAddPast', 'busSavePast', '__html']);
    (globalThis as any).__sent = sent;
    await busAddPast(0);
    expect(sent).toEqual([['GET', '/bus/addresses', 'studentId=s1']]);
    expect(__html()).toContain('a1,a2'); // the address they used last time is pre-selected (first)
    await busSavePast(0);
    expect(sent[1]).toEqual(['POST', '/bus/riders', { studentId: 's1', addressId: 'a1' }]);
  });
  // Task 13: a Generate/lock in progress must block the write itself, with a toast, even
  // though the Past riders list stays visible and tappable.
  it('is blocked (with a toast, no POST) while Generate/lock is active', async () => {
    const sent: unknown[] = [];
    const { busAddPast } = loadFns(['busAddPast'], `const BUS = { view: { pastRiders: ${JSON.stringify(past)} } };
      let __msg = null;
      function _busBlockWrite() { __msg = 'Routes are being generated — try again in a moment'; return true; }
      async function _busSend(m, url, body) { globalThis.__sent.push([m, url, body]); }
      function toast() {} function renderBus() {}
      function __state() { return { msg: __msg }; }`, ['busAddPast', '__state']);
    (globalThis as any).__sent = sent;
    await busAddPast(0);
    expect(sent).toEqual([]);
  });
});

// Task 3: a guest with no prior ride is hard-deleted server-side along with their saved
// address once removed — students are never deleted. The confirm sheet should say so, but
// only for a guest.
describe('busConfirmRemove warns about guest deletion only for a guest rider (Task 3)', () => {
  const mk = (riders: unknown[]) => {
    const prelude = `
      const BUS = { view: { riders: ${JSON.stringify(riders)} } };
      function esc(s) { return String(s); }
      let __modal = null;
      function modal(h) { __modal = h; }
      function __state() { return { modalHtml: __modal }; }
    `;
    return loadFns(['busConfirmRemove'], prelude, ['busConfirmRemove', '__state']);
  };
  it('adds the guest-deletion note for a guest', () => {
    const { busConfirmRemove, __state } = mk([{ id: 'r1', name: 'Jess', guestId: 'g1' }]);
    busConfirmRemove('r1');
    expect(__state().modalHtml).toContain("This also deletes their saved address and phone");
  });
  it('omits it for a student (never deleted)', () => {
    const { busConfirmRemove, __state } = mk([{ id: 'r1', name: 'Jess', guestId: null }]);
    busConfirmRemove('r1');
    expect(__state().modalHtml).not.toContain('also deletes');
  });
});

// Task 2: turning off (or archiving) a car that currently has riders would bounce them to
// Unassigned — confirm first; skip the confirm when the car is already empty.
describe('busToggleVeh confirms turning off a car only when it has riders (Task 2)', () => {
  const mk = (riderCount: number) => {
    const riders = Array.from({ length: riderCount }, (_, i) => ({ id: 'r' + i, runVehicleId: 'rv1' }));
    const prelude = `
      const BUS = { view: { vehicles: [{ id: 'rv1', name: 'Van A' }], riders: ${JSON.stringify(riders)} } };
      function esc(s) { return String(s); }
      let __modal = null, __sent = [];
      function modal(h) { __modal = h; }
      function closeModal() {}
      function toast() {}
      async function _busSend(m, p, b) { __sent.push([m, p, b]); }
      function __state() { return { modalHtml: __modal, sent: __sent }; }
    `;
    return loadFns(['busToggleVeh', 'busRunVeh', '_busRidersOnCar'], prelude, ['busToggleVeh', '__state']);
  };
  it('shows a confirm (and re-checks the box) when the car has riders', () => {
    const { busToggleVeh, __state } = mk(3);
    const checkbox = { checked: false };
    busToggleVeh(checkbox, 'rv1', false);
    expect(checkbox.checked).toBe(true);
    expect(__state().modalHtml).toContain('Turn off Van A?');
    expect(__state().modalHtml).toContain('Its 3 riders go back to Unassigned.');
    expect(__state().sent).toEqual([]); // not sent yet — waiting on confirm
  });
  it('turns off immediately with no confirm when the car is empty', async () => {
    const { busToggleVeh, __state } = mk(0);
    await busToggleVeh({ checked: false }, 'rv1', false);
    expect(__state().modalHtml).toBeNull();
    expect(__state().sent).toEqual([['PATCH', '/bus/run/vehicles/rv1', { running: false }]]);
  });
  it('never confirms turning a car ON', async () => {
    const { busToggleVeh, __state } = mk(3);
    await busToggleVeh({ checked: true }, 'rv1', true);
    expect(__state().modalHtml).toBeNull();
    expect(__state().sent).toEqual([['PATCH', '/bus/run/vehicles/rv1', { running: true }]]);
  });
});

describe('busConfirmArchiveVehicle confirms only when the car has riders (Task 2)', () => {
  const mk = (riderCount: number) => {
    const riders = Array.from({ length: riderCount }, (_, i) => ({ id: 'r' + i, runVehicleId: 'rv1' }));
    const prelude = `
      const BUS = { view: { fleet: [{ id: 'v1', name: 'Van A' }], vehicles: [{ id: 'rv1', vehicleId: 'v1' }], riders: ${JSON.stringify(riders)} } };
      function esc(s) { return String(s); }
      let __modal = null, __patched = null;
      function modal(h) { __modal = h; }
      function closeModal() {}
      function toast() {}
      function _busQs() { return ''; }
      async function busRefresh() {}
      const API = { patch: async (url, body) => { __patched = { url, body }; } };
      function __state() { return { modalHtml: __modal, patched: __patched }; }
    `;
    return loadFns(['busConfirmArchiveVehicle', 'busArchiveVehicle', '_busRidersOnCar'], prelude, ['busConfirmArchiveVehicle', '__state']);
  };
  it('confirms when the car has riders, and does not archive yet', () => {
    const { busConfirmArchiveVehicle, __state } = mk(2);
    busConfirmArchiveVehicle('v1');
    expect(__state().modalHtml).toContain('Archive Van A?');
    expect(__state().modalHtml).toContain('Its 2 riders go back to Unassigned.');
    expect(__state().patched).toBeNull();
  });
  it('archives immediately when the car is empty', async () => {
    const { busConfirmArchiveVehicle, __state } = mk(0);
    await busConfirmArchiveVehicle('v1');
    expect(__state().modalHtml).toBeNull();
    expect(__state().patched?.url).toContain('/bus/vehicles/v1');
    expect(__state().patched?.body.archived).toBe(true);
  });
});

// Task 10: the "Needs N more leader(s)" chip must show the REAL shortfall to the 2-leader
// minimum, not always "1 more".
describe('_busCarsHtml computes the real leader shortfall (Task 10)', () => {
  const mk = (leaderIds: string[]) => {
    const rv = { id: 'rv1', vehicleId: 'v1', running: true, name: 'Van A', plate: '', seats: 8, capacity: 8,
      eligibility: { unknown: false, female: true, male: true }, leaderIds, leaderNames: leaderIds, endsAt: 'church', endsAddress: '' };
    const prelude = `
      const BUS = { generating: false, view: { run: { lockBy: null, lockUntil: null }, fleet: [], vehicles: [${JSON.stringify(rv)}],
        leaders: [], riders: [], availablePoolLeaderIds: [] } };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; }
      function _busPrefGradesChip() { return ''; } function getMyLeaderId() { return BUS.me || null; }
    `;
    return loadFns(['_busCarsHtml', '_busBusChips', '_busLockedBy'], prelude, ['_busCarsHtml'])._busCarsHtml();
  };
  it('needs 2 more with no leaders', () => {
    expect(mk([])).toContain('Needs 2 more leaders');
  });
  it('needs 1 more (singular) with exactly 1 leader', () => {
    expect(mk(['L1'])).toContain('Needs 1 more leader<');
  });
  it('shows no chip once the car has 2+ leaders', () => {
    const html = mk(['L1', 'L2']);
    expect(html).not.toContain('more leader');
  });
});

// Task 11: coordinators can remove someone else's own car from Car setup.
describe('busRemoveOwnCarFor names the car owner in ?owner= (Task 11, 2026-10-15)', () => {
  it('deletes using the car owner\'s leader id, not the caller\'s own', async () => {
    const prelude = `
      const BUS = { view: { vehicles: [{ id: 'rv1', name: 'Josh\\'s car', ownerLeaderId: 'L9' }] } };
      function esc(s) { return String(s); }
      function _busQs(extra) { return 'now=x&as=L1' + (extra ? '&' + extra : ''); }
      let __deleted = null;
      function closeModal() {}
      function toast() {}
      async function busRefresh() {}
      const API = { del: async (url) => { __deleted = url; } };
      function __state() { return { deleted: __deleted }; }
    `;
    const { busRemoveOwnCarFor, __state } = loadFns(['busRemoveOwnCarFor'], prelude, ['busRemoveOwnCarFor', '__state']);
    await busRemoveOwnCarFor('rv1');
    expect(__state().deleted).toContain('/bus/run/own-car?');
    expect(__state().deleted).toContain('owner=L9');
    expect(__state().deleted).toContain('as=L1');
  });
  it('does nothing for a car with no owner', async () => {
    const prelude = `
      const BUS = { view: { vehicles: [{ id: 'rv1', ownerLeaderId: null }] } };
      let __deleted = null;
      const API = { del: async (url) => { __deleted = url; } };
      function closeModal() {}
      function toast() {}
      async function busRefresh() {}
      function __state() { return { deleted: __deleted }; }
    `;
    const { busRemoveOwnCarFor, __state } = loadFns(['busRemoveOwnCarFor'], prelude, ['busRemoveOwnCarFor', '__state']);
    await busRemoveOwnCarFor('rv1');
    expect(__state().deleted).toBeNull();
  });
});

// Task 12: phone is optional on New Person; when entered it must have >=8 digits (spaces/
// dashes don't count against it).
describe('busSaveNewPerson: phone is optional, validated by digit count when present (Task 12)', () => {
  const mk = (phone: string) => {
    const fields: Record<string, { value: string }> = {
      'np-first': { value: 'Jess' }, 'np-last': { value: 'Tran' }, 'np-grade': { value: '9' }, 'np-phone': { value: phone },
    };
    const prelude = `
      const BUS = { search: '' };
      let _busNpGender = 'female';
      const document = { getElementById: (id) => (${JSON.stringify(fields)})[id] };
      function _busBlockWrite() { return false; }
      function _busReadAddress() { return { addressId: 'a1' }; } function _busOverMsg() { return ''; }
      function _busQs() { return ''; }
      let __posted = null, __sent = [];
      const API = { post: async (url, body) => { __posted = body; return { id: 'g1', name: 'Jess Tran' }; } };
      async function _busSend(m, p, b) { __sent.push([m, p, b]); }
      function closeModal() {}
      function toast(m) { globalThis.__toast = m; }
      function renderBus() {}
      function __state() { return { posted: __posted, sent: __sent, toastMsg: globalThis.__toast }; }
    `;
    return loadFns(['busSaveNewPerson'], prelude, ['busSaveNewPerson', '__state']);
  };
  it('saves fine with no phone at all', async () => {
    const { busSaveNewPerson, __state } = mk('');
    await busSaveNewPerson();
    expect(__state().posted.phone).toBeNull();
    expect(__state().sent).toHaveLength(1);
    expect(__state().toastMsg).toBe('Jess Tran added'); // I10: the server's tidied name
  });
  it('rejects a phone with fewer than 8 digits', async () => {
    const { busSaveNewPerson, __state } = mk('1234');
    await busSaveNewPerson();
    expect(__state().toastMsg).toBe('Check the phone number');
    expect(__state().sent).toHaveLength(0);
  });
  it('accepts a formatted phone with 8+ digits', async () => {
    const { busSaveNewPerson, __state } = mk('0412 345 678');
    await busSaveNewPerson();
    expect(__state().posted.phone).toBe('0412 345 678');
    expect(__state().sent).toHaveLength(1);
  });
});

// Task 14: the server ranks phone matches first and flags them with byPhone — the suggestion
// prompt should call that out.
describe('_busNewPeopleCard shows "same phone" for a byPhone suggestion (Task 14)', () => {
  const mk = (byPhone: boolean) => {
    const prelude = `
      const BUS = { view: { pendingNewPeople: 1 }, pending: [{ id: 'p1', name: 'New Kid', grade: 9, phone: '0412345678',
        createdAt: '2026-10-01T00:00:00.000Z', suggestions: [{ name: 'Jess Tran', grade: 9, studentId: 's1', byPhone: ${byPhone} }] }] };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function L(k) { return k; }
    `;
    return loadFns(['_busNewPeopleCard', 'fmtDay'], prelude)._busNewPeopleCard();
  };
  it('adds "— same phone" when the match is by phone', () => {
    expect(mk(true)).toContain('Is this Jess Tran (Y9) — same phone?');
  });
  it('omits it for a plain name/grade match', () => {
    expect(mk(false)).toContain('Is this Jess Tran (Y9)?');
    expect(mk(false)).not.toContain('same phone');
  });
});

// Task 15: a plain leader can't reach Bus settings — tell them who to ask instead of sending
// them to a page they have no button for.
describe('_busMyCarHtml church dead-end message depends on who can fix it (Task 15)', () => {
  const mk = (role: string, canCoordinate: boolean) => {
    const prelude = `
      const BUS = { view: { leaders: [{ id: 'L1', name: 'Amy' }], canCoordinate: ${canCoordinate} },
        myCar: { vehicle: { id: 'rv1', name: 'Van A', leaderIds: ['L1'], leaderNames: ['Amy'], ownerLeaderId: null, needsFemaleLeader: false },
          churchAddress: '', stops: [] } };
      const S = { user: { role: ${JSON.stringify(role)} } };
      function getMyLeaderId() { return 'L1'; }
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function _busMapsLinks() { return []; }
      function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; }
      function _busConsentChip() { return ''; }
      function _busPinnedIcon() { return ''; }
      function _busFmtTime() { return ''; }
    `;
    return loadFns(['_busMyCarHtml', 'progBar', ...TRIP], prelude)._busMyCarHtml();
  };
  it('tells a plain leader to ask an admin', () => {
    expect(mk('leader', false)).toContain('Ask an admin to set the church address');
  });
  it('tells a coordinator (no Bus settings button) to ask an admin too', () => {
    expect(mk('leader', true)).toContain('Ask an admin to set the church address');
    expect(mk('quad', true)).toContain('Ask an admin to set the church address');
  });
  it('still points an admin at Bus settings', () => {
    expect(mk('admin', false)).toContain('Set the church address in Bus settings');
  });
});

// Task 9: Leaders-on-car sheet should use the same sticky Cancel+Save row as Edit vehicle.
describe('busEditCarLeaders uses the .bus-sheet-actions Cancel+Save row (Task 9)', () => {
  it('renders Cancel and Save inside .bus-sheet-actions', () => {
    const prelude = `
      const BUS = { view: { vehicles: [{ id: 'rv1', name: 'Van A', leaderIds: [] }], leaders: [{ id: 'L1', name: 'Amy', gender: 'female' }] } };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      let __modal = null;
      function modal(h) { __modal = h; }
      function __state() { return { modalHtml: __modal }; }
    `;
    const { busEditCarLeaders, __state } = loadFns(['busEditCarLeaders'], prelude, ['busEditCarLeaders', '__state']);
    busEditCarLeaders('rv1');
    const html = __state().modalHtml;
    expect(html).toContain('class="bus-sheet-actions"');
    expect(html).toContain('onclick="closeModal()"');
    expect(html).toContain("busSaveCarLeaders('rv1')");
  });
});

// Task 5: the Undo button must not be usable while another device holds the lock.
describe('_busUndoBar disables Undo while another device holds the lock (Task 5)', () => {
  const mk = (lockBy: string | null, lockUntil: string | null) => {
    const prelude = `
      const BUS = { generating: false, view: { run: { readOnly: false, canCoordinate: true, undoUntil: '2099-01-01T00:00:00.000Z',
        lockBy: ${JSON.stringify(lockBy)}, lockUntil: ${JSON.stringify(lockUntil)} }, canCoordinate: true } };
    `;
    return loadFns(['_busUndoBar', '_busLockedBy'], prelude, ['_busUndoBar'])._busUndoBar();
  };
  it('is enabled with no live lock', () => {
    expect(mk(null, null)).not.toContain('disabled');
  });
  it('is disabled while another device holds a live lock', () => {
    expect(mk('Sarah', '2099-01-01T00:00:00.000Z')).toContain('disabled');
  });
});

// Task 5: a failed toggle (Turn off / Fit in, etc. via busRunVeh) must snap the UI back
// instead of leaving a checkbox showing a state the server rejected.
describe('busRunVeh calls busRefresh() on failure so a rejected toggle snaps back (Task 5)', () => {
  it('toasts the error and still refreshes', async () => {
    const calls: string[] = [];
    const prelude = `
      async function _busSend() { throw new Error('boom'); }
      function toast(m) { globalThis.__calls.push('toast:' + m); }
      async function busRefresh() { globalThis.__calls.push('busRefresh'); }
    `;
    const { busRunVeh } = loadFns(['busRunVeh'], prelude);
    (globalThis as any).__calls = calls;
    await busRunVeh('rv1', { running: false });
    expect(calls).toEqual(['toast:boom', 'busRefresh']);
  });
});

// Task 7: a run vehicle's endsAt/endsAddress can differ from the fleet default as a
// tonight-only override — Edit vehicle must pre-fill from THAT, not silently show (and risk
// reverting) the fleet default, and start the checkbox checked.
describe('busEditVehicle pre-fills from the run vehicle when it has a tonight-only override (Task 7)', () => {
  const mk = (rv: unknown) => {
    const prelude = `
      const BUS = { ac: {}, view: { fleet: [{ id: 'v1', name: 'Van A', plate: '', seats: 8, prefGrades: [], endsAt: 'church', endsAddress: '' }],
        vehicles: [${JSON.stringify(rv)}], leaders: [] } };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function _gradeWord() { return 'Year'; }
      const window = {};
      let __modal = null;
      function modal(h) { __modal = h; }
      function __state() { return { modalHtml: __modal }; }
    `;
    return loadFns(['busEditVehicle', '_busEndsAtField', '_busAcField', '_busUuid'], prelude, ['busEditVehicle', '__state']);
  };
  it('pre-fills the override address and checks "Tonight only" when rv differs from the fleet default', () => {
    const { busEditVehicle, __state } = mk({ id: 'rv1', vehicleId: 'v1', endsAt: 'address', endsAddress: '9 Temp St', endsPlaceId: 'PT' });
    busEditVehicle('v1');
    const html = __state().modalHtml;
    expect(html).toContain('value="9 Temp St"');
    expect(html).toMatch(/id="ve-tonight" checked/);
  });
  it('shows the fleet default unchecked when there is no override', () => {
    const { busEditVehicle, __state } = mk({ id: 'rv1', vehicleId: 'v1', endsAt: 'church', endsAddress: '' });
    busEditVehicle('v1');
    const html = __state().modalHtml;
    expect(html).not.toContain('value="9 Temp St"');
    expect(html).not.toMatch(/id="ve-tonight" checked/);
  });
});

// Task 8: the header Analysis button gets an active/pressed style, and the analysis body
// gets a quick way back to Routes.
describe('Analysis active indicator and back link (Task 8)', () => {
  it('_busAnalysisHtml puts a "Back to Assign" link at the top, even on error', () => {
    const prelude = `
      const BUS = { analysisErr: 'boom', tab: 'analysis' };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
    `;
    const html = loadFns(['_busAnalysisHtml'], prelude)._busAnalysisHtml();
    expect(html).toContain('Back to Assign');
    expect(html.indexOf('Back to Assign')).toBeLessThan(html.indexOf('boom'));
  });
  it('the header Analysis button is index.html-sourced and switches class with BUS.tab', () => {
    const html = loadIndexHtml();
    const block = html.slice(html.indexOf('/* ── BUS MODULE ── */'), html.indexOf('/* ── END BUS MODULE ── */'));
    expect(block).toContain("BUS.tab === 'analysis' ? 'btn-primary' : 'btn-secondary'");
  });
});

// Task D (owner, 2026-10-08): "No address" (addressId missing) vs the pre-existing "No map pin"
// (an address Google can't locate) — both leave a rider out of Generate, but only the chip text
// differs, and "No address" takes priority since placeId is also null in that case.
describe('_busPinChip (Task D)', () => {
  const load = () => loadFns(['_busPinChip'], `function icS(k){return k;}`);
  it('shows "No address" when there is no saved address at all', () => {
    expect(load()._busPinChip({ studentId: 's1', addressId: null, placeId: null })).toContain('No address');
  });
  it('shows "No map pin" for a saved address Google could not locate', () => {
    expect(load()._busPinChip({ studentId: 's1', addressId: 'a1', address: '1 A St', placeId: null })).toContain('No map pin');
  });
  it('is blank when both are present', () => {
    expect(load()._busPinChip({ studentId: 's1', addressId: 'a1', address: '1 A St', placeId: 'P1' })).toBe('');
  });
  it('review E4: redacted (junior) rows get none; Trip logging (soft) is neutral; a bus-only rider is "No address"', () => {
    expect(load()._busPinChip({ studentId: null, guestId: null, addressId: null, address: 'Carina' })).toBe('');
    expect(load()._busPinChip({ studentId: 's1', addressId: null }, true)).toContain('c-neutral');
    expect(load()._busPinChip({ studentId: 's1', addressId: null }, true)).not.toContain('c-warn');
    expect(load()._busPinChip({ studentId: 's1', addressId: 'bus1', address: '', placeId: null })).toContain('No address');
  });
  it('R19-L5/K1: a placed rider with no address (e.g. moved off a bus with no home) is neutral; Unassigned stays a warning', () => {
    const placed = load()._busPinChip({ studentId: 's1', addressId: null, address: '', runVehicleId: 'rv1' });
    expect(placed).toContain('c-neutral');
    expect(placed).toContain('No address');
    expect(load()._busPinChip({ studentId: 's1', addressId: null, address: '', runVehicleId: null })).toContain('c-warn');
  });
});

// Task A (owner, 2026-10-08): "Edit my car" — reorder (↑/↓) and two-tap remove, saved via
// POST /bus/run/my-car/stops.
describe('Task A: Edit my car sheet', () => {
  const mk = (ownerLeaderId: string | null = null) => {
    const prelude = `
      const BUS = { myCar: { vehicle: { id: 'rv1', name: 'Van', ownerLeaderId: ${JSON.stringify(ownerLeaderId)}, leaderIds: ['L1'],
          seats: 5, plate: null, endsAt: 'church', endsAddress: null, endsPlaceId: null },
        stops: [{ id: 'r1', name: 'Jess', address: '1 A St, Carina' }, { id: 'r2', name: 'Sam', address: '2 B St, Bulimba' }] } };
      function getMyLeaderId() { return 'L1'; }
      function esc(s) { return String(s); }
      function icS(k) { return k; }
      function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; }
      let __modal = null;
      function modal(h) { __modal = h; }
      function closeModal() { __modal = null; }
      let __sent = null;
      function toast() {}
      async function _busSend(m, p, b) { __sent = [m, p, b]; }
      function busOwnCarSheet() {}
      function __state() { return { modalHtml: __modal, sent: __sent, order: BUS._emcOrder, removed: BUS._emcRemoved }; }
    `;
    return loadFns(['busEditMyCarSheet', '_busRenderEditMyCar', '_busEmcRemove', 'busSaveMyCarStops', '_busEmcCarDetails', ...TRIP],
      prelude, ['busEditMyCarSheet', '_busEmcRemove', 'busSaveMyCarStops', '__state']);
  };
  it('opens with both stops in server order', () => {
    const { busEditMyCarSheet, __state } = mk();
    busEditMyCarSheet();
    expect(__state().order).toEqual(['r1', 'r2']);
    expect(__state().modalHtml).toContain('1. Jess');
    expect(__state().modalHtml).toContain('2. Sam');
  });
  it('removing a stop is two-tap: first arms, second moves it to the removed list', () => {
    const { busEditMyCarSheet, _busEmcRemove, __state } = mk();
    busEditMyCarSheet();
    const btn: any = { dataset: {}, textContent: '', style: {} };
    _busEmcRemove(btn, 'r1');
    expect(btn.dataset.armed).toBe('1');
    expect(__state().order).toEqual(['r1', 'r2']); // not removed yet
    _busEmcRemove(btn, 'r1');
    expect(__state().order).toEqual(['r2']);
    expect(__state().removed).toEqual(['r1']);
  });
  it('Save posts the current order and removed ids, then closes', async () => {
    const { busEditMyCarSheet, _busEmcRemove, busSaveMyCarStops, __state } = mk();
    busEditMyCarSheet();
    const btn: any = { dataset: {}, textContent: '', style: {} };
    _busEmcRemove(btn, 'r1'); _busEmcRemove(btn, 'r1');
    await busSaveMyCarStops();
    expect(__state().sent).toEqual(['POST', '/bus/run/my-car/stops', { riderIds: ['r2'], removeIds: ['r1'] }]);
    expect(__state().modalHtml).toBeNull();
  });
  it('shows "Car details" only for the leader\'s own (manually added) car', () => {
    const notOwn = mk(null);
    notOwn.busEditMyCarSheet();
    expect(notOwn.__state().modalHtml).not.toContain('Car details');
    const own = mk('L1');
    own.busEditMyCarSheet();
    expect(own.__state().modalHtml).toContain('Car details');
  });
});

// Task C (owner, 2026-10-08): two-tap trash on a "Past riders" row.
describe('Task C: busDeletePastRider (two-tap)', () => {
  const mk = () => {
    const prelude = `
      const BUS = { view: { pastRiders: [{ studentId: 's1', guestId: null, name: 'Jess' }, { studentId: null, guestId: 'g1', name: 'Harper' }] } };
      let __sent = null;
      async function _busSend(method, path, body, extra) { __sent = [method, path, extra]; }
      function toast() {}
      function __state() { return { sent: __sent }; }
    `;
    return loadFns(['busDeletePastRider'], prelude, ['busDeletePastRider', '__state']);
  };
  it('first tap arms the button without calling the server', async () => {
    const { busDeletePastRider, __state } = mk();
    const btn: any = { dataset: {}, textContent: '', style: {} };
    await busDeletePastRider(btn, 0);
    expect(btn.dataset.armed).toBe('1');
    expect(__state().sent).toBeNull();
  });
  it('second tap deletes by studentId, through _busSend (so now=/as= are carried)', async () => {
    const { busDeletePastRider, __state } = mk();
    const btn: any = { dataset: {}, textContent: '', style: {} };
    await busDeletePastRider(btn, 0); await busDeletePastRider(btn, 0);
    expect(__state().sent).toEqual(['DELETE', '/bus/past-riders', 'studentId=s1']);
  });
  it('deletes by guestId when the row has no studentId', async () => {
    const { busDeletePastRider, __state } = mk();
    const btn: any = { dataset: {}, textContent: '', style: {} };
    await busDeletePastRider(btn, 1); await busDeletePastRider(btn, 1);
    expect(__state().sent).toEqual(['DELETE', '/bus/past-riders', 'guestId=g1']);
  });
});

// Task D (owner, 2026-10-08): deleting the CURRENT address reopens the edit sheet (the server
// unassigned the rider); a non-current delete just removes its row, as before.
describe('Task D: busDeleteAddress reopens the sheet for the current address', () => {
  it('reopens busEditRider when the deleted address was the rider\'s current one', async () => {
    const prelude = `
      const BUS = { view: { riders: [{ id: 'r1', addressId: 'a1' }] } };
      const document = { querySelector: () => null, getElementById: () => null };
      async function _busSend() {}
      let __reopened = null;
      function busEditRider(id) { __reopened = id; }
      function toast() {}
      function __state() { return { reopened: __reopened }; }
    `;
    const { busDeleteAddress, __state } = loadFns(['busDeleteAddress'], prelude, ['busDeleteAddress', '__state']);
    await busDeleteAddress('r1', 'a1');
    expect(__state().reopened).toBe('r1');
  });
  it('just removes the row for a non-current address, without reopening', async () => {
    const prelude = `
      const BUS = { view: { riders: [{ id: 'r1', addressId: 'a1' }] } };
      let __removed = false;
      const document = { querySelector: () => null, getElementById: () => ({ remove: () => { __removed = true; } }) };
      async function _busSend() {}
      function busEditRider() { throw new Error('must not reopen'); }
      function toast() {}
      function __state() { return { removed: __removed }; }
    `;
    const { busDeleteAddress, __state } = loadFns(['busDeleteAddress'], prelude, ['busDeleteAddress', '__state']);
    await busDeleteAddress('r1', 'old');
    expect(__state().removed).toBe(true);
  });
});

describe('past history helpers', () => {
  it('_busPeople aggregates per person, skips not-riding, flags regular/new/guest', () => {
    const { _busPeople } = loadFns(['_busPeople']);
    const r = (date: string, studentId: string | null, guestId: string | null, extra = {}) =>
      ({ date, studentId, guestId, name: studentId ?? guestId, kind: studentId ? 'student' : 'guest', notRiding: false, ...extra });
    const rides = [r('2026-10-02', 's1', null), r('2026-09-25', 's1', null), r('2026-10-02', null, 'g1'),
      r('2026-09-25', 's2', null, { notRiding: true }), r('2026-06-01', 's3', null)];
    const p = _busPeople(rides, 2, '2026-10-09');
    expect(p.map((x: any) => x.key)).toEqual(['s1', 'g1', 's3']);
    expect(p[0]).toMatchObject({ rides: 2, first: '2026-09-25', last: '2026-10-02', regular: true, isNew: true });
    expect(p[1].guest).toBe(true);
    expect(p[2].isNew).toBe(false);
  });
  it('_busPastIso combines night date and time, blank is null, pre-6am rolls over', () => {
    const { _busPastIso } = loadFns(['_busPastIso']);
    expect(_busPastIso('2026-10-02', '')).toBeNull();
    const d = new Date(_busPastIso('2026-10-02', '21:15'));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2, 21, 15]);
    expect(new Date(_busPastIso('2026-10-02', '00:30')).getDate()).toBe(3);
  });
  it('_busPickTab accepts past for Past viewers only', () => {
    const { _busPickTab } = loadFns(['_busPickTab']);
    expect(_busPickTab(['mycar'], 'past', true)).toBe('past');
    expect(_busPickTab(['mycar'], 'past', false)).toBe('mycar');
  });
});

describe('_busRoutesHtml Lock control (I11)', () => {
  const mkStubs = `
    function esc(s) { return String(s); }
    function icS(k) { return k; }
    function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; }
    function _busConsentChip() { return ''; }
    function _busPinChip() { return ''; }
    function _busCarColour() { return '#000'; }
    function _busPinnedIcon() { return ''; }
    function _busRoutesHead() { return ''; }
    function _busUndoBar() { return ''; }
  `;
  const car = (over: any = {}) => ({ id: 'rv1', name: 'Van A', vehicleId: 'v1', running: true, colourIndex: 0, capacity: 4, leaderNames: [],
    eligibility: { female: true, male: true, unknown: false }, locked: false, ...over });
  const html = (vehicles: any[], canCoordinate: boolean) => {
    const v = { run: { readOnly: false }, canCoordinate, riders: [], vehicles };
    return loadFns(['_busRoutesHtml', '_busBusChips', '_busGradeChip'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`)._busRoutesHtml();
  };
  it('a coordinator gets the Lock checkbox, ticked when locked, with the id in data-rv', () => {
    expect(html([car()], true)).toContain('onchange="busLockCar(this)" data-rv="rv1"> Lock</label>');
    expect(html([car({ locked: true })], true)).toContain('<input type="checkbox" checked aria-label="Lock Van A" title="Generate and Unassign all leave this car alone" onchange="busLockCar(this)"');
  });
  it('read-only viewers see a Locked chip only when locked, never the checkbox', () => {
    expect(html([car({ locked: true })], false)).toContain('Locked</span>');
    expect(html([car({ locked: true })], false)).not.toContain('busLockCar');
    expect(html([car()], false)).not.toContain('Locked');
  });
  it('own cars get no Lock control', () => {
    expect(html([car({ vehicleId: null, ownerLeaderId: 'L1' })], true)).not.toContain('busLockCar');
  });
  it('busLockCar PATCHes locked for that car, and is undone while Generate holds the lock', () => {
    const run = (blocked: boolean, checked: boolean) => {
      const { busLockCar, __calls } = loadFns(['busLockCar'], `
        let __c = [];
        function _busBlockWrite() { return ${blocked}; }
        function busRunVeh(id, patch) { __c.push([id, patch]); }
        function __calls() { return __c; }`, ['busLockCar', '__calls']);
      const el = { checked, dataset: { rv: 'rv1' } };
      busLockCar(el);
      return { calls: __calls(), el };
    };
    expect(run(false, true).calls).toEqual([['rv1', { locked: true }]]);
    const b = run(true, true);
    expect(b.calls).toEqual([]);
    expect(b.el.checked).toBe(false);
  });
});

describe('_busCarsHtml header totals (I12)', () => {
  const mk = (riders: number) => {
    const rv = (id: string, seats: number, leaders: number, running = true) => ({ id, vehicleId: 'v' + id, running, name: 'Car ' + id, plate: '',
      seats, capacity: seats - leaders, eligibility: { unknown: false, female: true, male: true },
      leaderIds: Array.from({ length: leaders }, (_, i) => 'L' + i), leaderNames: [], endsAt: 'church', endsAddress: '' });
    const v = { run: { lockBy: null, lockUntil: null }, fleet: [], vehicles: [rv('1', 5, 1), rv('2', 9, 2), rv('3', 8, 2, false)],
      leaders: [], riders: Array.from({ length: riders }, (_, i) => ({ id: 'r' + i, runVehicleId: null, name: 'R' + i })), availablePoolLeaderIds: [] };
    const prelude = `
      const BUS = { generating: false, view: ${JSON.stringify(v)} };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function _busSuburb(a) { return a; } function _busWhere(r) { return r.address; }
      function _busPrefGradesChip() { return ''; } function getMyLeaderId() { return BUS.me || null; }
    `;
    return loadFns(['_busCarsHtml', '_busBusChips', '_busLockedBy'], prelude, ['_busCarsHtml'])._busCarsHtml();
  };
  it('counts youth seats in running cars and riders tonight; no chip when there are enough seats', () => {
    const html = mk(3);
    expect(html).toContain('<b>11</b> seats for youth in 2 cars');
    expect(html).toContain('<b>3</b> students tonight');
    expect(html).not.toContain('short');
  });
  it('shows "N short" when riders exceed seats', () => {
    expect(mk(12)).toContain('1 short</span>');
  });
});

// BUS-1 Trip logging (operator 2026-10-18, RULINGS Session 2).
describe('BUS-1 Trip logging', () => {
  it('Trip logging is the last tab; landing is Students (or Car setup via _busPickTab)', () => {
    const rb = extractFn(loadIndexHtml(), 'renderBus');
    expect(rb.indexOf("label: 'Trip logging'")).toBeGreaterThan(rb.indexOf("label: 'Assign'"));
    expect(rb).not.toContain("label: 'My car'");
    const { _busPickTab } = loadFns(['_busPickTab']);
    expect(_busPickTab(['cars', 'routes', 'mycar'], 'roster', false, false)).toBe('cars'); // junior leader
    expect(_busPickTab(['roster', 'cars', 'routes', 'mycar'], 'roster', false, false)).toBe('roster');
    expect(extractFn(loadIndexHtml(), '_navLanding')).toContain("BUS.tab = 'roster'");
  });
  it('_busToday uses the 06:00 cutoff', () => {
    const at = (args: string) => `const __RD = globalThis.Date; class Date extends __RD { constructor(...a) { super(...(a.length ? a : [${args}])); } }`;
    expect(loadFns(['_busToday', '_busLocalNow'], at('2026, 9, 10, 0, 40'))._busToday()).toBe('2026-10-09'); // Sat 00:40 -> Friday
    expect(loadFns(['_busToday', '_busLocalNow'], at('2026, 9, 14, 19, 0'))._busToday()).toBe('2026-10-14');
    expect(loadFns(['_busToday', '_busLocalNow'], at('2026, 10, 1, 3, 0'))._busToday()).toBe('2026-10-31'); // month edge
  });
  it('_busTripDate defaults to today; _busTripQs carries it', () => {
    const { _busTripDate, _busTripQs } = loadFns(['_busTripDate', '_busTripQs'], "const BUS = { tripDate: null }; function _busToday() { return '2026-10-14'; }");
    expect(_busTripDate()).toBe('2026-10-14');
    expect(_busTripQs()).toBe('date=2026-10-14');
  });
  it('busSetTripDate stores the day, clears my car + draft, refreshes and repaints', () => {
    const prelude = `const BUS = { tripDate: null, myCar: { x: 1 }, ocDraft: { y: 1 } }; let __r = 0, __p = 0;
      function busRefresh() { __r++; } function renderBus() { __p++; } function __s() { return { b: BUS, r: __r, p: __p }; }`;
    const { busSetTripDate, __s } = loadFns(['busSetTripDate'], prelude, ['busSetTripDate', '__s']);
    busSetTripDate('2026-10-12');
    expect(__s()).toMatchObject({ b: { tripDate: '2026-10-12', myCar: null, ocDraft: null }, r: 1, p: 1 });
    busSetTripDate('');
    expect(__s().b.tripDate).toBeNull();
  });
  // R19-S6: behavioural: drive each trip call through the real _busSend/_busGet/_busQs and read the sent URLs.
  it('every trip write and the my-car read send ?date= for the chosen day; Car setup removal does not', async () => {
    const fns = ['busSaveOwnCar', 'busRemoveOwnCarConfirmed', 'busToggleDropped', 'busSaveDroppedTime', 'busOptimiseMyCar',
      'busSaveMyCarStops', 'busMoveStop', 'busRemoveOwnCarFor', 'busRefresh', '_busSend', '_busGet', '_busQs', '_busDropAtIso', ...TRIP];
    const f = loadFns(fns, `const __urls = [];
      const rec = (m) => async (u) => { __urls.push(m + ' ' + u); return u.startsWith('/bus/run?') ? { run: { id: 'r', version: 1 } } : { skipped: [] }; };
      const API = { post: rec('POST'), patch: rec('PATCH'), del: rec('DELETE'), fresh: rec('GET') };
      const BUS = { tripDate: '2026-10-12', gen: 0, ocDraft: { newRiders: [] }, _emcOrder: ['s1'], _emcRemoved: [],
        myCar: { stops: [{ id: 's1' }, { id: 's2' }] }, view: { vehicles: [{ id: 'rv9', ownerLeaderId: 'L9' }] } };
      const S = { user: null, page: 'x' };
      const __vals = { 'oc-ends': 'last_drop', 'oc-seats': '5', 'oc-name': 'Car', 'bd-time': '21:30' };
      const document = { getElementById: (id) => ({ value: __vals[id] || '' }), querySelectorAll: () => [] };
      function getMyLeaderId() { return 'L1'; } function _busAcValue() { return { address: '', placeId: null }; }
      function _busSkippedMsg() { return ''; } function closeModal() {} function toast() {} function __u() { return __urls; }`,
      [...fns, '__u']);
    const date = (u: string) => new URLSearchParams(u.split('?')[1]).get('date');
    const sent = async (call: () => unknown) => { f.__u().length = 0; await call(); return f.__u().filter((u: string) => !u.startsWith('GET')); };
    for (const call of [() => f.busSaveOwnCar(), () => f.busRemoveOwnCarConfirmed(), () => f.busToggleDropped('s1', true),
      () => f.busSaveDroppedTime('s1'), () => f.busOptimiseMyCar(null), () => f.busSaveMyCarStops(), () => f.busMoveStop(0, 1)]) {
      const w = await sent(call);
      expect(w).toHaveLength(1);
      expect(date(w[0])).toBe('2026-10-12');
    }
    f.__u().length = 0; await f.busRefresh();
    const myCar = f.__u().find((u: string) => u.startsWith('GET /bus/my-car?'));
    expect(date(myCar)).toBe('2026-10-12');
    expect(date(f.__u().find((u: string) => u.startsWith('GET /bus/run?')))).toBeNull(); // the run view is tonight's
    const rm = await sent(() => f.busRemoveOwnCarFor('rv9'));
    expect(rm[0]).toContain('owner=L9');
    expect(date(rm[0])).toBeNull(); // Car setup: tonight
  });
  it('the Trip logging tab shows a Day picker limited to 14 back / 7 ahead', () => {
    const prelude = `
      const BUS = { tripDate: '2026-10-12', view: { leaders: [{ id: 'L1', name: 'Amy' }] }, myCar: null };
      function getMyLeaderId() { return 'L1'; }
      function esc(s) { return String(s); }
      function _busToday() { return '2026-10-14'; }
    `;
    const { _busMyCarHtml } = loadFns(['_busMyCarHtml', 'progBar', '_busTripDate', '_busLocalNow'], prelude);
    const html = _busMyCarHtml();
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-10-12"');
    expect(html).toContain('min="2026-09-30"');
    expect(html).toContain('max="2026-10-21"');
    expect(html).toContain('onchange="busSetTripDate(this.value)"');
  });
});

// R19-L3 (lane A server: GET /bus/run/version follows ?date=, never creates a run).
describe('R19-L3 poll follows the trip date', () => {
  const poll = (tab: string, tripDate: string | null, versions: Record<string, number>) => loadFns(['_busPollTick', '_busTripQs', '_busTripDate'], `
    const S = { page: 'bus' }; const document = { hidden: false, getElementById: () => null };
    const BUS = { tab: '${tab}', tripDate: ${tripDate ? `'${tripDate}'` : 'null'}, version: 7, view: { run: { serviceDate: '2026-10-16' } } };
    const __urls = []; let __r = 0; const __vv = ${JSON.stringify(versions)};
    async function _busGet(p, extra) { __urls.push(p + (extra ? '?' + extra : '')); return { version: __vv[extra || 'tonight'] }; }
    function _busEditing() { return false; } function busRefresh() { __r++; } function _busToday() { return '2026-10-14'; }
    function __s() { return { urls: __urls, r: __r }; } function __v() { return __vv; }`, ['_busPollTick', '__s', '__v']);
  it('tonight (or another tab) polls the run version with no date, as before', async () => {
    const f = poll('roster', '2026-10-12', { tonight: 8 });
    await f._busPollTick();
    expect(f.__s()).toEqual({ urls: ['/bus/run/version'], r: 1 });
    const t = poll('mycar', '2026-10-16', { tonight: 7 });
    await t._busPollTick();
    expect(t.__s()).toEqual({ urls: ['/bus/run/version'], r: 0 });
  });
  it('a trip on another day polls that date and refreshes only when its own version moves', async () => {
    const f = poll('mycar', null, { 'date=2026-10-14': 3 }); // today (Wed) is not the bus night
    await f._busPollTick(); await f._busPollTick();
    expect(f.__s().urls).toEqual(['/bus/run/version?date=2026-10-14', '/bus/run/version?date=2026-10-14']);
    expect(f.__s().r).toBe(0); // first tick learns the version; tonight's BUS.version (7) is never compared
    f.__v()['date=2026-10-14'] = 4; // someone else edits the trip
    await f._busPollTick(); await f._busPollTick();
    expect(f.__s().r).toBe(1);
  });
});

describe('BUS-1 Log a trip sheet (address optional, 4 taps)', () => {
  const pickPrelude = (addresses: string) => `const BUS = { ocHits: [{ kind: 'student', id: 's1', name: 'Jess Tran', addresses: ${addresses} }],
    ocDraft: { car: null, riderIds: [], newRiders: [] }, ocSearch: 'je' };
    let __sheet = 0; function busOwnCarSheet() { __sheet++; } function _busOcSyncDraft() {} function modal() { throw new Error('no modal'); }
    function _busAddrLabel(a) { return a.label; } function __s() { return { d: BUS.ocDraft, sheet: __sheet, q: BUS.ocSearch }; }`;
  it('busOcPick adds the hit straight to the draft with its latest saved address, no picker modal', () => {
    const { busOcPick, __s } = loadFns(['busOcPick'], pickPrelude("[{ id: 'a1', label: 'Home', address: '1 A St, Carina' }]"), ['busOcPick', '__s']);
    busOcPick(0);
    expect(__s().d.newRiders[0]).toMatchObject({ studentId: 's1', addressId: 'a1', addrLabel: 'Home' });
    expect(__s().sheet).toBe(1);
    expect(__s().q).toBe('');
  });
  it('a hit with no saved address is added with no address', () => {
    const { busOcPick, __s } = loadFns(['busOcPick'], pickPrelude('[]'), ['busOcPick', '__s']);
    busOcPick(0);
    const r = __s().d.newRiders[0];
    expect(r).toMatchObject({ studentId: 's1', addrLabel: 'No address' });
    expect(r.addressId).toBeUndefined();
    expect(r.newAddress).toBeUndefined();
  });
  const readPrelude = (pick: string, text: string, placeId: string | null) => `
    let __t = null; function toast(m) { __t = m; }
    const document = { querySelector: () => (${JSON.stringify(pick)} ? { value: ${JSON.stringify(pick)} } : null),
      getElementById: () => ({ value: 'Mum' }) };
    function _busAcValue() { return { address: ${JSON.stringify(text)}, placeId: ${JSON.stringify(placeId)} }; }
    function __t_() { return __t; }`;
  it('_busReadAddress(true): empty New address = no address; typed-but-unpicked still refused', () => {
    let f = loadFns(['_busReadAddress'], readPrelude('new', '', null), ['_busReadAddress', '__t_']);
    expect(f._busReadAddress(true)).toEqual({});
    expect(f._busReadAddress()).toBeNull(); // required path unchanged
    f = loadFns(['_busReadAddress'], readPrelude('new', '1 A St', null), ['_busReadAddress', '__t_']);
    expect(f._busReadAddress(true)).toBeNull();
    expect(f.__t_()).toBe('Pick the address from the suggestions list');
    f = loadFns(['_busReadAddress'], readPrelude('a1', '', null), ['_busReadAddress', '__t_']);
    expect(f._busReadAddress(true)).toEqual({ addressId: 'a1' });
  });
  const sheetPrelude = (tripDate: string, myCar: string) => `
    const BUS = { tripDate: '${tripDate}', ocDraft: null, myCar: ${myCar},
      view: { run: { serviceDate: '2026-10-16' }, leaders: [{ id: 'L1', name: 'Tom Strange' }],
        riders: [{ id: 'fr1', name: 'Friday Rider', address: '2 B St, Carina', runVehicleId: null }] } };
    let __html = ''; function modal(h) { __html = h; }
    function esc(s) { return String(s == null ? '' : s); } function fmtDay(d) { return 'DAY ' + d; } function icS() { return ''; }
    function getMyLeaderId() { return 'L1'; } function _busOcHitsHtml() { return ''; } function _busAcField() { return ''; }
    function _busToday() { return '2026-10-14'; }
    function __h() { return __html; } function __d() { return BUS.ocDraft; }`;
  const sheet = (tripDate: string, myCar = 'null') =>
    loadFns(['busOwnCarSheet', '_busEndsAtField', '_busSuburb', '_busTripDate'], sheetPrelude(tripDate, myCar), ['busOwnCarSheet', '__h', '__d']);
  it('busOwnCarSheet hides "students waiting" when the trip date is not tonight', () => {
    const f = sheet('2026-10-14');
    f.busOwnCarSheet();
    expect(f.__h()).toContain('Log a trip · DAY 2026-10-14');
    expect(f.__h()).not.toContain('Friday Rider');
    expect(f.__h()).not.toContain('still waiting');
    const t = sheet('2026-10-16');
    t.busOwnCarSheet();
    expect(t.__h()).toContain('Friday Rider');
    expect(t.__h()).toContain('still waiting');
  });
  it('on another day, the riders already in this trip stay listed (ticked) so a car-details save keeps them', () => {
    const f = sheet('2026-10-14', "{ vehicle: { id: 'rv' }, stops: [{ id: 'w1', name: 'Wed Rider', address: '' }] }");
    f.busOwnCarSheet(false);
    expect(f.__h()).toMatch(/id="oc-riders"[\s\S]*value="w1" checked/);
    expect(f.__h()).not.toContain('Friday Rider');
  });
  it('a new trip defaults to Ends at last drop, 5 seats and a "<first name>s car" name; a remembered car is used', () => {
    const f = sheet('2026-10-14');
    f.busOwnCarSheet();
    expect(f.__h()).toContain('<option value="last_drop" selected');
    expect(f.__h()).toContain('value="5"');
    expect(f.__h()).toContain(`value="Tom's car"`);
    const r = sheet('2026-10-14', "{ vehicle: null, stops: [], ownCarDraft: { car: { name: 'Red Mazda', seats: 4, plate: null, endsAt: 'church', endsAddress: null }, riderIds: [] } }");
    r.busOwnCarSheet();
    expect(r.__h()).toContain('value="Red Mazda"');
    expect(r.__h()).toContain('<option value="church" selected');
  });
  it('new-rider rows get an Address button; busSaveOwnCar no longer forces an end address and strips UI fields', () => {
    const html = loadIndexHtml();
    expect(extractFn(html, 'busOwnCarSheet')).toContain('busOcAddr(${i})');
    const save = extractFn(html, 'busSaveOwnCar');
    expect(save).not.toContain('Pick the address');
    expect(extractFn(html, 'busOcSaveNewPerson')).toContain('_busReadAddress(true)');
  });
  it('busSaveOwnCar posts new riders without the UI-only fields (name, addrLabel, addresses)', async () => {
    const f = loadFns(['busSaveOwnCar'], `let __body = null;
      const BUS = { ocDraft: { newRiders: [{ studentId: 's1', addressId: 'a1', name: 'Jess', addrLabel: 'Home', addresses: [{ id: 'a1' }] }] } };
      const __vals = { 'oc-ends': 'last_drop', 'oc-seats': '5', 'oc-name': "Tom's car", 'oc-plate': '' };
      const document = { getElementById: (id) => ({ value: __vals[id] }), querySelectorAll: () => [] };
      async function _busSend(m, p, b) { __body = b; return { skipped: [] }; } function _busTripQs() { return ''; }
      function _busAcValue() { return { address: '', placeId: null }; } function _busSkippedMsg() { return ''; }
      function closeModal() {} function toast() {} function __b() { return __body; }`, ['busSaveOwnCar', '__b']);
    await f.busSaveOwnCar();
    expect(f.__b().newRiders).toEqual([{ studentId: 's1', addressId: 'a1' }]);
  });
  it('R19-S4: the trip sheet has no Plate field; a remembered plate still saves', async () => {
    const f = sheet('2026-10-14', "{ vehicle: null, stops: [], ownCarDraft: { car: { name: 'Red Mazda', seats: 4, plate: 'ABC123', endsAt: 'church', endsAddress: null }, riderIds: [] } }");
    f.busOwnCarSheet();
    expect(f.__h()).not.toContain('oc-plate');
    expect(f.__h()).not.toContain('Plate');
    const s = loadFns(['busSaveOwnCar'], `let __body = null;
      const BUS = { ocDraft: { car: { plate: 'ABC123' }, newRiders: [] } };
      const __vals = { 'oc-ends': 'last_drop', 'oc-seats': '4', 'oc-name': 'Red Mazda' };
      const document = { getElementById: (id) => (id in __vals ? { value: __vals[id] } : null), querySelectorAll: () => [] };
      async function _busSend(m, p, b) { __body = b; return { skipped: [] }; } function _busTripQs() { return ''; }
      function _busAcValue() { return { address: '', placeId: null }; } function _busSkippedMsg() { return ''; }
      function closeModal() {} function toast() {} function __b() { return __body; }`, ['busSaveOwnCar', '__b']);
    await s.busSaveOwnCar();
    expect(s.__b().car).toMatchObject({ name: 'Red Mazda', seats: 4, plate: 'ABC123' });
  });
  it('busOcConfirmPick(j) replaces row j address', () => {
    const prelude = `const BUS = { ocDraft: { newRiders: [{ studentId: 's1', name: 'J', addresses: [{ id: 'a1', label: 'Home' }, { id: 'a2', label: 'Dad' }], addressId: 'a1', addrLabel: 'Home' }] } };
      let __r = null; function _busReadAddress() { return __r; } function _busAddrLabel(a) { return a.label; } function busOwnCarSheet() {}
      function __set(v) { __r = v; } function __d() { return BUS.ocDraft; }`;
    const f = loadFns(['busOcConfirmPick'], prelude, ['busOcConfirmPick', '__set', '__d']);
    f.__set({ addressId: 'a2' }); f.busOcConfirmPick(0);
    expect(f.__d().newRiders[0]).toMatchObject({ addressId: 'a2', addrLabel: 'Dad' });
    f.__set({ newAddress: { label: '', address: '9 C St', placeId: 'p' } }); f.busOcConfirmPick(0);
    expect(f.__d().newRiders[0].addressId).toBeUndefined();
    expect(f.__d().newRiders[0]).toMatchObject({ newAddress: { address: '9 C St' }, addrLabel: '9 C St' });
  });
  // A saved trip on the Trip logging tab (R19-U11 / U14 harness).
  const tripView = (rv: string, stops = "[{ id: 's1', name: 'Jess Tran', address: '', grade: 9 }]", extra = '') => loadFns(['_busMyCarHtml', '_busTripDate', '_busLocalNow', '_busSuburb'], `
    const BUS = { tripDate: '2026-10-14', view: { leaders: [{ id: 'L1', name: 'Amy' }] },
      myCar: { churchAddress: '', vehicle: ${rv}, stops: ${stops} } };
    const S = { user: { role: 'grade' } };
    function getMyLeaderId() { return 'L1'; } function esc(s) { return String(s == null ? '' : s); } function icS() { return ''; }
    function _busToday() { return '2026-10-14'; } function dncChip() { return ''; } function _busWhere() { return ''; }
    function _busConsentChip() { return ''; } function _busPinChip() { return ''; } function _busPinnedIcon() { return ''; } function _lkSwitchGuard() {} ${extra}`)._busMyCarHtml();
  it('R19-U11: the trip card carries a meta line (seats, where it ends)', () => {
    const own = "{ id: 'rv', name: \"Amy's car\", seats: 5, plate: null, ownerLeaderId: 'L1', leaderIds: ['L1'], leaderNames: ['Amy'], endsAt: 'last_drop', endsAddress: null }";
    expect(tripView(own)).toContain('5 seats · Ends at last drop');
    expect(tripView(own.replace("'last_drop'", "'church'"))).toContain('5 seats · Ends at church');
    expect(tripView(own.replace("'last_drop', endsAddress: null", "'address', endsAddress: '3 Oak St, Carina QLD 4152'"))).toContain('5 seats · Ends at Carina');
    expect(tripView(own.replace("leaderIds: ['L1'], leaderNames: ['Amy']", "leaderIds: ['L1', 'L2'], leaderNames: ['Amy', 'Bo']"))).toContain('5 seats · Ends at last drop · with Bo');
  });
  it('R19-U14 flow S9: "Edit trip" on an own car ("Edit stops" on a fleet car); "Stop order" only over 2+ riders', () => {
    const own = "{ id: 'rv', name: 'Car', seats: 5, plate: null, ownerLeaderId: 'L1', leaderIds: ['L1'], leaderNames: ['Amy'], endsAt: 'church', endsAddress: null }";
    const one = tripView(own);
    expect(one).toContain('Edit trip');
    expect(one).not.toContain('Edit my car');
    expect(one).not.toContain('Stop order');
    const two = tripView(own.replace("ownerLeaderId: 'L1'", 'ownerLeaderId: null'), "[{ id: 's1', name: 'A', address: '' }, { id: 's2', name: 'B', address: '' }]");
    expect(two).toContain('Stop order');
    expect(two).toContain('Edit stops');
  });
  it('R19-U14 flow F7: a remembered "I am" that is no longer a leader shows the name picker, not a blank name', () => {
    const html = loadFns(['_busMyCarHtml', 'progBar', '_busTripDate', '_busLocalNow'], `
      const BUS = { tripDate: null, view: { leaders: [{ id: 'L1', name: 'Amy' }] }, myCar: { vehicle: null, stops: [], ownCarDraft: { car: null, riderIds: [] } } };
      function getMyLeaderId() { return 'GONE'; } function esc(s) { return String(s); } function fmtDay(d) { return d; }
      function icS() { return ''; } function icLg() { return ''; } function _busToday() { return '2026-10-14'; }`)._busMyCarHtml();
    expect(html).toContain('Choose your name');
    expect(html).not.toContain('Log a trip');
  });
  it('R19-U14 #16: "I am" and "Day" use the sheet label style', () => {
    const own = "{ id: 'rv', name: 'Car', seats: 5, plate: null, ownerLeaderId: 'L1', leaderIds: ['L1'], leaderNames: ['Amy'], endsAt: 'church', endsAddress: null }";
    const h = tripView(own);
    expect(h).toContain('<span class="fl">I am</span>');
    expect(h).toContain('<label class="fl" for="bus-trip-date">Day</label>');
  });
  it('the empty Trip logging card says "No trip logged" and offers Log a trip', () => {
    const prelude = `
      const BUS = { tripDate: null, view: { leaders: [{ id: 'L1', name: 'Amy' }] }, myCar: { vehicle: null, stops: [], ownCarDraft: { car: null, riderIds: [] } } };
      function getMyLeaderId() { return 'L1'; } function esc(s) { return String(s); } function fmtDay(d) { return 'DAY ' + d; }
      function icS() { return ''; } function icLg() { return ''; } function _busToday() { return '2026-10-14'; }`;
    const html = loadFns(['_busMyCarHtml', 'progBar', '_busTripDate', '_busLocalNow'], prelude)._busMyCarHtml();
    expect(html).toContain('No trip logged for DAY 2026-10-14');
    expect(html).toContain('Log a trip');
    expect(html).not.toContain('Driving your own car?');
  });
});

describe('BUS-1 Past + export mark trips', () => {
  const prelude = `
    const BUS = { histErr: '', histSub: 'nights', histPeople: [], hist: { rides: [], nights: [
      { id: 'w', date: '2026-10-14', trip: true, riders: 1, cars: 1 }, { id: 'f', date: '2026-10-09', trip: false, riders: 4, cars: 2 }] } };
    function esc(s) { return String(s); } function icS() { return ''; } function icEmpty() { return ''; } function progBar() { return ''; }
    function _busByRun() { return {}; } function _busNotLogged() { return 0; } function _busHDate(d) { return d; }
    let __chart = null; function colChart(r) { __chart = r; return ''; }
    function statCard(v) { return 'STAT:' + v.join('|'); } function __c() { return __chart; }`;
  it('the Nights list chips a trip; Nights / Avg riders / chart count bus nights only', () => {
    const f = loadFns(['_busHistHtml'], prelude, ['_busHistHtml', '__c']);
    const html = f._busHistHtml();
    expect(html.match(/>Trip</g)).toHaveLength(1);
    expect(html).toContain('STAT:1|4|');
    expect(f.__c().map((x: any) => x.id)).toEqual(['f']);
  });
  it('review E2: a trip row never says "not logged"; with no bus nights the 0/0/0/0 stats are hidden', () => {
    const pre2 = prelude.replace('function _busNotLogged() { return 0; }', 'function _busNotLogged() { return 2; }');
    const html = loadFns(['_busHistHtml'], pre2, ['_busHistHtml'])._busHistHtml();
    expect(html.match(/not logged/g)).toHaveLength(1); // the Fri bus night only
    const onlyTrips = pre2.replace("{ id: 'f', date: '2026-10-09', trip: false, riders: 4, cars: 2 }", '');
    expect(loadFns(['_busHistHtml'], onlyTrips, ['_busHistHtml'])._busHistHtml()).not.toContain('STAT:');
  });
  it('busLoadHist feeds _busPeople bus-night rides and the bus-night count', async () => {
    const pre = `const BUS = {}; let __args = null;
      async function _busGet() { return { nights: [{ id: 'w', trip: true }, { id: 'f', trip: false }, { id: 'g', trip: false }],
        rides: [{ runId: 'w', name: 'A' }, { runId: 'f', name: 'B' }] }; }
      function _busPeople(r, n) { __args = [r.map((x) => x.runId), n]; return []; } function _busLocalNow() { return '2026-10-18T10:00'; }
      function __a() { return __args; }`;
    const f = loadFns(['busLoadHist'], pre + ' function __b() { return BUS; }', ['busLoadHist', '__a', '__b']);
    await f.busLoadHist();
    expect(f.__a()).toEqual([['f'], 2]);
    expect([...f.__b().histTrip]).toEqual(['w']); // R19-S3: the one trip-id set, reused by the export
  });
});

// BUS-2 (charter bus, 2026-10-18): Car setup — bus kind on the vehicle sheet and the card.
describe('BUS-2 Car setup', () => {
  const view = (over: any = {}) => ({ run: { readOnly: false, lockBy: null, lockUntil: null }, leaders: [], availablePoolLeaderIds: [],
    fleet: [{ id: 'v1', name: 'Charter', kind: 'bus', seats: 3, endsAt: 'address', endsAddress: '9 Hall St, Carina QLD', prefGrades: [] }],
    riders: [{ id: 'r1', runVehicleId: 'rv1' }, { id: 'r2', runVehicleId: 'rv1' }, { id: 'r3', runVehicleId: 'rv1' }],
    vehicles: [{ id: 'rv1', vehicleId: 'v1', name: 'Charter', kind: 'bus', running: true, seats: 3, capacity: 2, leaderIds: ['L1'], leaderNames: ['Tom'],
      eligibility: { female: false, male: true, unknown: false }, endsAt: 'address', endsAddress: '9 Hall St, Carina QLD', colourIndex: 0, ...over }] });
  const cars = (v: any, me = '') => loadFns(['_busCarsHtml', '_busBusChips', '_busLockedBy', '_busSuburb'], `
      const BUS = { generating: false, me: '${me}', view: ${JSON.stringify(v)} };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function _busPrefGradesChip() { return ''; } function getMyLeaderId() { return BUS.me || null; }`, ['_busCarsHtml'])._busCarsHtml();
  it('bus card: Bus chip, Over by N, Drop-off label, no gender chip; leaders unchanged', () => {
    const h = cars(view());
    expect(h).toContain('>Bus</span>');
    expect(h).toContain('Over by 1');
    expect(h).toContain('Drop-off: <b');
    expect(h).toContain('Carina');
    expect(h).not.toContain('Boys');
    expect(h).toContain('Needs 1 more leader');
    expect(h).toContain('>Tom<');
  });
  it('no Over chip at or under capacity; a car keeps its gender chip and Ends at label', () => {
    expect(cars(view({ capacity: 3 }))).not.toContain('Over by');
    const car = cars(view({ kind: 'car' }));
    expect(car).toContain('Boys'); expect(car).toContain('Ends at:'); expect(car).not.toContain('>Bus</span>');
  });
  it('a bus that is off tonight is still badged', () => {
    expect(cars(view({ running: false }))).toContain('>Bus</span>');
  });
  it('review E3: bus overflow is not "short", the noun says "1 bus"; E5: no empty Drop-off label; E13: driving link', () => {
    const h = cars(view());
    expect(h).toContain('<b>3</b> seats for youth in 1 bus ·');
    expect(h).not.toContain('short');
    expect(cars(view({ endsAddress: null }))).not.toContain('Drop-off:');
    expect(h).not.toContain("You're driving");
    expect(cars({ ...view(), run: { serviceDate: '2026-10-23' } }, 'L1')).toContain("You're driving Charter tonight — open");
  });
  const sheet = (fleetKind?: string) => {
    const { busEditVehicle, __state } = loadFns(['busEditVehicle', '_busEndsAtField', '_busAcField', '_busUuid'], `
      const BUS = { ac: {}, view: { fleet: [{ id: 'v1', name: 'Charter', plate: '', seats: 20, prefGrades: [], endsAt: 'address', endsAddress: '9 Hall St', endsPlaceId: 'P', ${fleetKind ? `kind: '${fleetKind}'` : ''} }], vehicles: [], leaders: [] } };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
      function _gradeWord() { return 'Year'; }
      const window = {};
      let __modal = null;
      function modal(h) { __modal = h; }
      function __state() { return __modal; }`, ['busEditVehicle', '__state']);
    busEditVehicle(fleetKind === undefined ? null : 'v1');
    return __state() as string;
  };
  it('vehicle sheet has the Charter bus checkbox, ticked only for a bus', () => {
    expect(sheet('bus')).toMatch(/id="ve-bus" checked/);
    expect(sheet('car')).toContain('id="ve-bus"');
    expect(sheet('car')).not.toMatch(/id="ve-bus" checked/);
    expect(sheet()).not.toMatch(/id="ve-bus" checked/); // Add vehicle defaults to a car
  });
  it('R19-U10: Preferred grades is hidden for a bus and follows the Charter bus tick', () => {
    expect(sheet('bus')).toMatch(/id="ve-grades-sec" hidden/);
    expect(sheet('car')).not.toMatch(/id="ve-grades-sec" hidden/);
    const els: Record<string, any> = { 've-ends': { value: 'church' }, 've-ends-wrap': { hidden: true }, 've-ends-addr': { focus() {} }, 've-grades-sec': { hidden: false } };
    const { _busVeBusTick } = loadFns(['_busVeBusTick'], 'const document = { getElementById: (id) => globalThis.__els[id] };');
    (globalThis as any).__els = els;
    _busVeBusTick(true);
    expect(els['ve-grades-sec'].hidden).toBe(true);
    expect(els['ve-ends'].value).toBe('address');
    _busVeBusTick(false);
    expect(els['ve-grades-sec'].hidden).toBe(false);
    delete (globalThis as any).__els;
  });
  it('busSaveVehicle sends kind, and refuses a bus without a drop-off address', async () => {
    const run = async (bus: boolean, ends: string) => {
      const { busSaveVehicle, __calls } = loadFns(['busSaveVehicle'], `
        const els = { 've-name': { value: 'Charter' }, 've-plate': { value: '' }, 've-seats': { value: '20' }, 've-ends': { value: '${ends}' }, 've-bus': { checked: ${bus} } };
        const document = { getElementById: (id) => els[id] || null, querySelectorAll: () => [] };
        const BUS = { view: { fleet: [], vehicles: [] } };
        let __c = [], __t = [];
        function _busAcValue() { return { address: '9 Hall St', placeId: 'P' }; }
        function _busQs() { return ''; }
        const API = { post: async (u, b) => { __c.push(b); return { id: 'v1' }; } };
        async function busRefresh() {}
        function closeModal() {}
        function toast(m) { __t.push(m); }
        function __calls() { return { calls: __c, toasts: __t }; }`, ['busSaveVehicle', '__calls']);
      await busSaveVehicle(null);
      return __calls();
    };
    expect((await run(true, 'address')).calls[0]).toMatchObject({ kind: 'bus', endsAt: 'address', endsPlaceId: 'P' });
    expect((await run(false, 'church')).calls[0]).toMatchObject({ kind: 'car' });
    const refused = await run(true, 'church');
    expect(refused.calls).toEqual([]);
    expect(refused.toasts[0]).toMatch(/drop-off address/);
  });
  // rel19 C1: the server reads a missing kind as 'car', so EVERY vehicle write must carry it or a bus is demoted.
  it('every PATCH of an existing bus carries kind (edit, tonight-only edit, archive)', async () => {
    const fleet = [{ id: 'v1', name: 'Charter', kind: 'bus', seats: 20, plate: null, prefGrades: [], endsAt: 'address', endsAddress: '9 Hall St', endsPlaceId: 'P' }];
    const run = async (tonight: boolean, fn = 'busSaveVehicle') => {
      const f = loadFns(['busSaveVehicle', 'busArchiveVehicle'], `
        const els = { 've-name': { value: 'Charter' }, 've-plate': { value: '' }, 've-seats': { value: '20' }, 've-ends': { value: 'address' }, 've-bus': { checked: true }, 've-tonight': { checked: ${tonight} } };
        const document = { getElementById: (id) => els[id] || null, querySelectorAll: () => [] };
        const BUS = { view: { fleet: ${JSON.stringify(fleet)}, vehicles: [{ id: 'rv1', vehicleId: 'v1' }] } };
        let __c = [];
        function _busAcValue() { return { address: '1 New St', placeId: 'Q' }; }
        function _busQs() { return ''; }
        const API = { patch: async (u, b) => { __c.push([u, b]); return { id: 'v1' }; } };
        async function _busSend(m, u, b) { __c.push([u, b]); }
        async function busRefresh() {}
        function closeModal() {}
        function toast() {}
        function __calls() { return __c; }`, ['busSaveVehicle', 'busArchiveVehicle', '__calls']);
      await f[fn]('v1');
      return f.__calls().filter(([u]: [string]) => u.startsWith('/bus/vehicles/'));
    };
    for (const calls of [await run(false), await run(true), await run(false, 'busArchiveVehicle')]) {
      expect(calls).toHaveLength(1);
      expect(calls[0][1].kind).toBe('bus');
    }
  });
});

// BUS-2: "Bus drop off: <address>" in the address picker (only while a bus runs) + rider labels.
describe('BUS-2 picker', () => {
  const pre = `const BUS = { ac: {}, view: { vehicles: [{ id: 'rv9', vehicleId: 'v9', kind: 'bus', running: true, endsAddress: '9 Hall St, Carina QLD' }] } }; const window = {};`;
  const fns = ['_busAddressPicker', '_busAddrLabel', '_busSuburb', 'esc', '_busAcField', '_busUuid'];
  it('offers the running bus; pre-selects it when it was their last choice', () => {
    const { _busAddressPicker } = loadFns(fns, pre);
    const h = _busAddressPicker([{ id: 'a1', vehicleId: 'v9', label: 'Bus drop off' }, { id: 'a2', vehicleId: null, label: 'Home', suburb: 'Carina' }]);
    expect(h).toMatch(/value="bus:rv9" checked/);
    expect(h).toContain('Bus drop off · 9 Hall St'); // review E8: one "Label · street · suburb" format
    expect(h).not.toContain('value="a1"'); // the bus row is not listed twice
    expect(h).not.toMatch(/value="a2" checked/);
  });
  it('offers the bus unticked when their last choice was a home address', () => {
    const { _busAddressPicker } = loadFns(fns, pre);
    const h = _busAddressPicker([{ id: 'a2', vehicleId: null, label: 'Home' }]);
    expect(h).toContain('value="bus:rv9"'); expect(h).not.toMatch(/value="bus:rv9" checked/); expect(h).toMatch(/value="a2" checked/);
  });
  it('bus not running tonight → no bus option; falls back to the first home address', () => {
    const { _busAddressPicker } = loadFns(fns, pre.replace('running: true', 'running: false'));
    const h = _busAddressPicker([{ id: 'a1', vehicleId: 'v9' }, { id: 'a2', vehicleId: null, label: 'Home' }]);
    expect(h).not.toContain('bus:rv9'); expect(h).toMatch(/value="a2" checked/);
  });
  it('own-car picker never offers the bus', () => {
    const { _busAddressPicker } = loadFns(fns, pre);
    expect(_busAddressPicker([], null, true)).not.toContain('bus:');
  });
  it('_busReadAddress returns busRunVehicleId for the bus option', () => {
    const { _busReadAddress } = loadFns(['_busReadAddress'], `const document = { querySelector: () => ({ value: 'bus:rv9' }) };`);
    expect(_busReadAddress()).toEqual({ busRunVehicleId: 'rv9' });
  });
  it('_busWhere labels bus riders', () => {
    const { _busWhere } = loadFns(['_busWhere', '_busSuburb'], pre);
    expect(_busWhere({ runVehicleId: 'rv9', address: '9 Hall St, Carina QLD' })).toBe('Bus drop off');
    expect(_busWhere({ runVehicleId: null, address: '24 Wynnum Rd, Carina QLD 4152, Australia' })).toBe('Carina');
  });
  it('own-car pickers pass noBus; rider rows use _busWhere', () => {
    const html = loadIndexHtml();
    // rel19: BUS-1's one-tap busOcPick skips bus rows; its Address button (busOcAddr) passes noBus.
    expect(extractFn(html, 'busOcPick')).toContain('.filter((x) => !x.vehicleId)[0]');
    expect(html).toContain('${_busAddressPicker(n.addresses || [], null, true)}');
    expect(html).toContain('${_busAddressPicker([], null, true)}');
    expect(html.match(/esc\(_busWhere\((r|s)\)\)/g)).toHaveLength(2);
    expect(html).toContain("_busWhere(s)].filter(Boolean).join(' · ')");
  });
});

// BUS-2: bus on Assign, the Move sheet, Maps links and My car.
describe('BUS-2 assign + move + maps', () => {
  it('_busMapsLinks: a bus is one stop (church → drop-off)', () => {
    const { _busMapsLinks } = loadFns(['_busMapsLinks']);
    const stops = [1, 2, 3].map(() => ({ address: '9 Hall St, Carina', placeId: 'P_hall' }));
    const links = _busMapsLinks(stops, '1 Church St', { kind: 'bus', endsAt: 'address', endsAddress: '9 Hall St, Carina', endsPlaceId: 'P_hall' }, 'P_ch');
    expect(links).toHaveLength(1);
    expect(links[0].url).toContain('destination=9%20Hall'); expect(links[0].url).not.toContain('waypoints=');
    expect(links[0].url).toContain('origin=1%20Church');
  });
  const mkStubs = `
    function esc(s) { return String(s); }
    function icS(k) { return k; }
    function _busSuburb(a) { return a; }
    function _busConsentChip() { return ''; }
    function _busPinChip() { return ''; }
    function _busCarColour() { return '#000'; }
    function _busPinnedIcon() { return ''; }
    function _busRoutesHead() { return ''; }
    function _busUndoBar() { return ''; }`;
  const bus = (over: any = {}) => ({ id: 'rv1', name: 'Charter', vehicleId: 'v1', kind: 'bus', running: true, colourIndex: 0, capacity: 1, leaderNames: [],
    eligibility: { female: false, male: true, unknown: false }, locked: false, needsFemaleLeader: true, ...over });
  const routes = (vehicles: any[]) => {
    const v = { run: { readOnly: false }, canCoordinate: true, vehicles,
      riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P' }, { id: 'r2', runVehicleId: 'rv1', gender: 'female', placeId: 'P' }] };
    return loadFns(['_busRoutesHtml', '_busBusChips', '_busGradeChip', '_busWhere'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`)._busRoutesHtml();
  };
  it('Assign bus card: Bus chip, Over by N, Bus drop off, no Lock, no gender warning, no stop numbers', () => {
    const h = routes([bus()]);
    expect(h).toContain('>Bus</span>'); expect(h).toContain('Over by 1'); expect(h).toContain('Bus drop off');
    expect(h).not.toContain('No female leader'); expect(h).not.toContain('Gender mismatch');
    expect(h).not.toContain('bus-lock-chk'); expect(h).not.toContain('<div class="stop-num">1<');
  });
  it('a car with the same riders keeps its warnings, numbers and Lock', () => {
    const h = routes([bus({ kind: 'car' })]);
    expect(h).toContain('No female leader'); expect(h).toContain('Gender mismatch'); expect(h).toContain('bus-lock-chk');
    expect(h).toContain('<div class="stop-num">1<'); expect(h).not.toContain('Over by');
  });
  const move = (vehicles: any[]) => {
    const { busMoveSheet, __state } = loadFns(['busMoveSheet'], `
      const BUS = { view: { riders: [{ id: 'r1', name: 'Amy', gender: 'female' }, { id: 'r2', runVehicleId: 'rv1' }], vehicles: ${JSON.stringify(vehicles)} } };
      function esc(s) { return String(s); }
      function _busCarColour(i) { return '#000'; }
      let __captured = '';
      function modal(h) { __captured = h; }
      function __state() { return __captured; }`, ['busMoveSheet', '__state']);
    busMoveSheet('r1');
    return __state() as string;
  };
  it('Move sheet: a full bus is still tappable, says Over capacity, and never arms the female-leader warning', () => {
    const h = move([bus({ capacity: 1 })]);
    expect(h).toContain('Over capacity');
    expect(h).not.toContain('disabled');
    expect(h).toContain("busMove('r1','rv1')");
  });
  it('Move sheet: a full car stays disabled', () => {
    expect(move([bus({ kind: 'car', capacity: 1 })])).toContain('disabled');
  });
  it('My car hides Optimise route on a bus', () => {
    const html = loadIndexHtml();
    expect(html).toContain("rv.kind !== 'bus' && mc.stops.filter((s) => !s.droppedAt).length > 1");
  });
});

// rel19 C1: the Bus header names the day you're looking at — the trip's day on Trip logging.
describe('rel19 header date', () => {
  const head = (tab: string, tripDate: string | null) => loadFns(['_busHeadDate', '_busTripDate', '_busToday', '_busLocalNow'],
    `const BUS = { tab: '${tab}', tripDate: ${tripDate ? `'${tripDate}'` : 'null'} };`)._busHeadDate({ run: { serviceDate: '2026-10-23' } });
  it('Trip logging on a Wed trip shows the Wed', () => { expect(head('mycar', '2026-10-14')).toBe('2026-10-14'); });
  it('other tabs show the bus night', () => { expect(head('routes', '2026-10-14')).toBe('2026-10-23'); });
  it('renderBus uses it', () => { expect(extractFn(loadIndexHtml(), 'renderBus')).toContain('fmtDay(_busHeadDate(v))'); });
});

describe('review B: skipped riders are named back', () => {
  it('_busSkippedMsg groups by car; empty → ""', () => {
    const { _busSkippedMsg } = loadFns(['_busSkippedMsg']);
    expect(_busSkippedMsg([])).toBe('');
    expect(_busSkippedMsg([{ name: 'Liam', car: 'Van' }, { name: 'Ben', car: 'Van' }, { name: 'Amy', car: 'Charter' }]))
      .toBe('Saved. Liam, Ben: already in Van; Amy: already in Charter — move them in Assign');
  });
});

describe('review E10: over-full bus toast', () => {
  const load = (riders: number) => loadFns(['_busOverMsg'], `const BUS = { view: { vehicles: [{ id: 'rv9', name: 'Charter', capacity: 2 }],
    riders: Array.from({ length: ${riders} }, () => ({ runVehicleId: 'rv9' })) } };`)._busOverMsg;
  it('names the bus and the overflow; nothing at or under capacity or off the bus', () => {
    expect(load(4)({ busRunVehicleId: 'rv9' })).toBe('. Charter is over by 2');
    expect(load(2)({ busRunVehicleId: 'rv9' })).toBe('');
    expect(load(4)({ addressId: 'a1' })).toBe('');
  });
});

describe('review E11: turning a bus off names riders with no home address', () => {
  it('lists them in the confirm', () => {
    const f = loadFns(['busToggleVeh', '_busRidersOnCar'], `let __m = ''; function modal(h) { __m = h; } function esc(s) { return String(s); } function busRunVeh() {}
      const __get = () => __m;
      const BUS = { view: { vehicles: [{ id: 'rv9', name: 'Charter', kind: 'bus' }], riders: [
        { runVehicleId: 'rv9', name: 'Amelia', noHome: true }, { runVehicleId: 'rv9', name: 'Sophia' }, { runVehicleId: 'rv9', name: 'Isabella', noHome: true }] } };`,
      ['busToggleVeh', '__get']);
    f.busToggleVeh({ checked: false }, 'rv9', false);
    expect(f.__get()).toContain('Its 3 riders go back to Unassigned at their home address. Amelia, Isabella have no home address yet.');
  });
});

// Review leftover: behaviour pin for the Past export "Type" column (the old test only matched source text).
describe('busExportHist Type column', () => {
  it('labels a trip night and its rides "Trip", a bus night "Bus night"', async () => {
    const prelude = `
      const sheets = {};
      const XLSX = { utils: { aoa_to_sheet: (aoa) => ({ aoa, '!ref': 'A1:A1' }), decode_range: () => ({ s: { c: 0 }, e: { c: -1 } }),
        encode_cell: () => 'A1', book_new: () => ({}), book_append_sheet: (wb, ws, name) => { sheets[name] = ws.aoa; } }, writeFile: () => {} };
      const _ensureXlsx = async () => {}; const toast = () => {}; const _busLocalNow = () => '2026-10-18T10:00';
      const BUS = { histPeople: [], histTrip: new Set(['r1']), hist: {
        nights: [{ id: 'r1', date: '2026-10-14', trip: true, leaders: [] }, { id: 'r2', date: '2026-10-16', trip: false, leaders: [] }],
        rides: [{ runId: 'r1', date: '2026-10-14', name: 'Jess Tran', leaders: [] }, { runId: 'r2', date: '2026-10-16', name: 'Sam Lee', leaders: [] }] } };`;
    const { busExportHist, sheets } = loadFns(['busExportHist', '_busByRun', '_busNotLogged', '_busFmtTime'], prelude, ['busExportHist', 'sheets']);
    await busExportHist();
    expect(sheets.Nights.slice(1).map((r: unknown[]) => [r[0], r[1]])).toEqual([['Trip', '2026-10-14'], ['Bus night', '2026-10-16']]);
    expect(sheets.Rides.slice(1).map((r: unknown[]) => [r[0], r[2]])).toEqual([['Trip', 'Jess Tran'], ['Bus night', 'Sam Lee']]);
  });
});
