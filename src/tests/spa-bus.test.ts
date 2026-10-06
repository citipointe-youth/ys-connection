import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { BUS_CAR_COLOURS } from '../services/bus-logic';

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
      function _busEditing() { return false; }
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
      const BUS = { view: null, myCar: null, version: -1, loading: null, failed: false, gen: 0, pendingRepaint: false };
      const S = { page: 'bus', user: { id: 'u1' } };
      const appHtml = [];
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
    const { renderBus, __state } = loadFns(['renderBus', 'busRefresh'], prelude, ['renderBus', '__state']);
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
      const BUS = { view: null, myCar: null, version: -1, loading: null, failed: false, gen: 0, pendingRepaint: false };
      const S = { page: 'bus', user: { id: 'u1' } };
      const calls = [];
      let __active = null;
      const document = {
        getElementById: (id) => (id === 'page-main' ? { contains: (el) => el === __active } : null),
        get activeElement() { return __active; },
      };
      async function _busGet(path) { return path === '/bus/run' ? { run: { version: 7 } } : { ok: true }; }
      function toast(m) {}
      function renderBus() { calls.push('renderBus'); }
      function renderHome() { calls.push('renderHome'); }
      function __setActive(tag) { __active = tag ? { tagName: tag } : null; }
      function __state() { return { calls, BUS }; }
    `;
    return loadFns(['busRefresh', '_busEditing'], prelude, ['busRefresh', '__setActive', '__state']);
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

// M4: unticking a previously-fixed leader in Edit Vehicle must drop them from TONIGHT's car
// too, not just from their standing leader-prefs record — a plain union only ever adds.
describe('busSaveVehicle drops an unticked fixed leader from tonight (M4)', () => {
  it('the run-vehicle PATCH leaderIds excludes the just-unticked leader', async () => {
    const prelude = `
      const BUS = { ac: {}, view: { fleet: [], leaders: [{ id: 'L1', fixedVehicleId: 'v1' }], vehicles: [{ id: 'rv1', vehicleId: 'v1', leaderIds: ['L1'] }] } };
      const __calls = [];
      const __sendCalls = [];
      const document = {
        getElementById: (id) => ({
          've-ends': { value: 'church' }, 've-ends-addr': { value: '' }, 've-tonight': null,
          've-name': { value: 'Big Bus' }, 've-plate': { value: '' }, 've-seats': { value: '5' },
        }[id] ?? null),
        querySelectorAll: (sel) => (sel === '#ve-leaders input' ? [{ value: 'L1', checked: false }] : []),
      };
      const API = {
        async patch(url, body) { __calls.push({ url, body }); return { id: 'v1' }; },
        async post(url, body) { __calls.push({ url, body }); return { id: 'v1' }; },
      };
      function _busQs() { return ''; }
      async function busRefresh() {}
      async function _busSend(method, path, body) { __sendCalls.push({ method, path, body }); }
      function closeModal() {}
      function toast() {}
      function __state() { return { calls: __calls, sendCalls: __sendCalls }; }
    `;
    const { busSaveVehicle, __state } = loadFns(['busSaveVehicle', '_busAcValue', '_busAcResolve'], prelude, ['busSaveVehicle', '__state']);
    await busSaveVehicle('v1');
    const st = __state();
    const rvPatch = st.sendCalls.find((c: any) => c.path === '/bus/run/vehicles/rv1');
    expect(rvPatch).toBeTruthy();
    expect(rvPatch.body.leaderIds).not.toContain('L1');
  });
});

describe('SPA escaping (final re-review)', () => {
  it('declares esc() exactly once, so the quote-escaping version is the one bound at runtime', () => {
    expect(loadIndexHtml().match(/function esc\(/g)).toHaveLength(1);
  });
  it('_busAddressPicker shows the suburb from /bus/search results', () => {
    const prelude = 'const BUS = { ac: {} }; const window = {};';
    const { _busAddressPicker } = loadFns(['_busAddressPicker', '_busSuburb', 'esc', '_busAcField', '_busUuid'], prelude);
    expect(_busAddressPicker([{ id: 'a1', label: 'Home', suburb: 'Carina' }])).toContain('Home · Carina');
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
  it('_busPickTab keeps Route analysis for director/admin only', () => {
    const { _busPickTab } = loadFns(['_busPickTab']);
    expect(_busPickTab(['routes', 'mycar'], 'analysis', true)).toBe('analysis');
    expect(_busPickTab(['routes', 'mycar'], 'analysis', false)).toBe('routes');
    expect(_busPickTab(['routes', 'mycar'], 'mycar', false)).toBe('mycar');
  });
  it('_busExtraLine reads as a plain sentence with no symbols', () => {
    const { _busExtraLine } = loadFns(['_busExtraLine']);
    expect(_busExtraLine({ count: 1, seats: 8, before: { longestMin: 52, totalMin: 150, unassigned: 2 }, after: { longestMin: 38, totalMin: 160, unassigned: 0 } }))
      .toBe('+1 car, 8 seats: longest route 38 min (now 52) · unassigned 0 (now 2)');
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
    function _busSuburb(a) { return a; }
    function _busConsentChip() { return ''; }
    function _busCarColour() { return '#000'; }
    function _busPinnedIcon() { return ''; }
    function _busRoutesHead() { return ''; }
    function _busUndoBar() { return ''; }
  `;
  const car = (over: any = {}) => ({ id: 'rv1', vehicleId: 'v1', running: true, colourIndex: 0, capacity: 4, leaderNames: [],
    eligibility: { female: true, male: true, unknown: false }, ...over });
  it('shows "Only 1 girl" when she shares no placeId with anyone else in the car', () => {
    const BUS = { run: undefined, routeMin: {} };
    const v = { run: { readOnly: false }, riders: [
      { id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P1' },
      { id: 'r2', runVehicleId: 'rv1', gender: 'male', placeId: 'P2' },
    ], vehicles: [car()] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    expect(_busRoutesHtml()).toContain('Only 1 girl');
    void BUS;
  });
  it('does not flag her when she shares a placeId with another rider in the car', () => {
    const v = { run: { readOnly: false }, riders: [
      { id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P1' },
      { id: 'r2', runVehicleId: 'rv1', gender: 'male', placeId: 'P1' },
    ], vehicles: [car()] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    expect(_busRoutesHtml()).not.toContain('Only 1 girl');
  });
  it('does not flag a car with two or more girls', () => {
    const v = { run: { readOnly: false }, riders: [
      { id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P1' },
      { id: 'r2', runVehicleId: 'rv1', gender: 'female', placeId: 'P2' },
    ], vehicles: [car()] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    expect(_busRoutesHtml()).not.toContain('Only 1 girl');
  });
  it('shows the per-car Route button only for a car with riders', () => {
    const v = { run: { readOnly: false }, riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'male', placeId: 'P1' }],
      vehicles: [car(), { ...car(), id: 'rv2' }] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    const html = _busRoutesHtml();
    expect(html).toContain("busOpenCarRoute('rv1')");
    expect(html).not.toContain("busOpenCarRoute('rv2')");
  });
});

describe('busGenerate toast mentions riders kept off a car alone', () => {
  it('includes the loneGirl count when > 0', async () => {
    const prelude = `
      const BUS = { generating: false };
      function closeModal() {}
      function renderBus() {}
      let __msg = null;
      function toast(m) { __msg = m; }
      function _busQs() { return ''; }
      async function busRefresh() {}
      const API = { post: async () => ({ loneGirl: 2, unassigned: 0, noAddressPin: 0 }) };
      function __state() { return { msg: __msg }; }
    `;
    const { busGenerate, __state } = loadFns(['busGenerate'], prelude, ['busGenerate', '__state']);
    await busGenerate('all');
    expect(__state().msg).toContain('2 kept off a car alone');
  });
  it('omits the note when loneGirl is 0', async () => {
    const prelude = `
      const BUS = { generating: false };
      function closeModal() {}
      function renderBus() {}
      let __msg = null;
      function toast(m) { __msg = m; }
      function _busQs() { return ''; }
      async function busRefresh() {}
      const API = { post: async () => ({ loneGirl: 0, unassigned: 0, noAddressPin: 0 }) };
      function __state() { return { msg: __msg }; }
    `;
    const { busGenerate, __state } = loadFns(['busGenerate'], prelude, ['busGenerate', '__state']);
    await busGenerate('all');
    expect(__state().msg).toBe('Routes ready');
  });
});

describe('_busRosterHtml locks add/search/remove while Generate is running or a coordinator holds the lock', () => {
  const stubs = `function esc(s) { return String(s); } function icS() { return ''; } function icEmpty() { return ''; }
     function _busSuburb(a) { return a; } function _busConsentChip() { return ''; } function _busCarColour() { return '#000'; }
     function _busHitsHtml() { return ''; }`;
  const run = (generating: boolean, lockBy: string | null, lockUntil: string | null) => {
    const prelude = `${stubs}
      const BUS = { search: '', generating: ${generating},
        view: { run: { readOnly: false, lockBy: ${JSON.stringify(lockBy)}, lockUntil: ${JSON.stringify(lockUntil)} },
          riders: [{ id: 'r1', name: 'Amy' }], vehicles: [] } };`;
    const { _busRosterHtml } = loadFns(['_busRosterHtml', '_busLockedBy'], prelude, ['_busRosterHtml']);
    return _busRosterHtml();
  };
  it('shows the search bar and remove button when nothing is blocking', () => {
    const html = run(false, null, null);
    expect(html).toContain('bus-q');
    expect(html).toContain('busConfirmRemove');
  });
  it('hides them while BUS.generating is true', () => {
    const html = run(true, null, null);
    expect(html).not.toContain('bus-q');
    expect(html).not.toContain('busConfirmRemove');
  });
  it('hides them while another coordinator holds a live lock', () => {
    const html = run(false, 'Sarah', '2099-01-01T00:00:00.000Z');
    expect(html).not.toContain('bus-q');
    expect(html).not.toContain('busConfirmRemove');
  });
});

// Bug fix (2026-10-06 follow-up): My car's picker used to re-render off the stale BUS.myCar
// fetched before any identity was chosen ("No car assigned."). Both onchange/onclick handlers
// must clear BUS.myCar and go through busRefresh() (which re-fetches /bus/my-car with the new
// ?as= leader and repaints), not call renderBus() directly off stale data.
describe('_busMyCarHtml identity picker refreshes BUS.myCar, not a bare renderBus (bug fix)', () => {
  it('choosing a name clears BUS.myCar and calls busRefresh', () => {
    const prelude = `
      const BUS = { view: { leaders: [{ id: 'L1', name: 'Amy' }] }, myCar: null };
      function getMyLeaderId() { return null; }
      function esc(s) { return String(s); }
    `;
    const { _busMyCarHtml } = loadFns(['_busMyCarHtml'], prelude);
    const html = _busMyCarHtml();
    expect(html).toContain('setMyLeaderId(this.value);BUS.myCar=null;busRefresh()');
    expect(html).not.toContain('renderBus()');
  });
  it('"Not you?" also clears BUS.myCar and calls busRefresh', () => {
    const prelude = `
      const BUS = { view: { leaders: [{ id: 'L1', name: 'Amy' }] }, myCar: null };
      function getMyLeaderId() { return 'L1'; }
      function esc(s) { return String(s); }
    `;
    const { _busMyCarHtml } = loadFns(['_busMyCarHtml'], prelude);
    const html = _busMyCarHtml();
    expect(html).toContain('setMyLeaderId(null);BUS.myCar=null;busRefresh()');
    expect(html).not.toContain('renderBus()');
  });
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
  it('offers a small sheet of links for more than 9 stops', () => {
    const riders = Array.from({ length: 11 }, (_, i) => ({ id: 'r' + i, runVehicleId: 'rv1', stopOrder: i + 1, address: `${i} A St`, placeId: 'P' + i }));
    const { busOpenCarRoute, __state } = mk(riders);
    busOpenCarRoute('rv1');
    expect(__state().opened).toBeNull();
    expect(__state().modalHtml).toContain('Van A route');
    expect((__state().modalHtml.match(/btn-primary btn-full/g) ?? []).length).toBe(2);
  });
  it('does nothing for a car with no riders', () => {
    const { busOpenCarRoute, __state } = mk([]);
    busOpenCarRoute('rv1');
    expect(__state().opened).toBeNull();
    expect(__state().modalHtml).toBeNull();
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
