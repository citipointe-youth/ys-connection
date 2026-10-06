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
    return loadFns(['busRefresh'], prelude, ['busRefresh', '__setAs', '__resolveAll', '__state']);
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
    const { _busAddressPicker } = loadFns(['_busAddressPicker', '_busAddrLabel', '_busSuburb', 'esc', '_busAcField', '_busUuid'], prelude);
    expect(_busAddressPicker([{ id: 'a1', label: 'Home', suburb: 'Carina' }])).toContain('Home · Carina');
  });
  it('_busAddressPicker falls back to the street when the saved address has no label', () => {
    const prelude = 'const BUS = { ac: {} }; const window = {};';
    const { _busAddressPicker } = loadFns(['_busAddressPicker', '_busAddrLabel', '_busSuburb', 'esc', '_busAcField', '_busUuid'], prelude);
    expect(_busAddressPicker([{ id: 'a1', label: '', street: '3 Lindsay Court', suburb: 'Cornubia' }])).toContain('3 Lindsay Court · Cornubia');
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
    function _busSuburb(a) { return a; }
    function _busConsentChip() { return ''; }
    function _busCarColour() { return '#000'; }
    function _busPinnedIcon() { return ''; }
    function _busRoutesHead() { return ''; }
    function _busUndoBar() { return ''; }
  `;
  const car = (over: any = {}) => ({ id: 'rv1', vehicleId: 'v1', running: true, colourIndex: 0, capacity: 4, leaderNames: [],
    eligibility: { female: true, male: true, unknown: false }, ...over });
  it('shows "No female leader" when the server flags the car', () => {
    const v = { run: { readOnly: false }, riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P1' }],
      vehicles: [car({ needsFemaleLeader: true })] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml', '_busGradeChip'], `${mkStubs}
const BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    expect(_busRoutesHtml()).toContain('No female leader');
  });
  it('does not show it when the car is not flagged', () => {
    const v = { run: { readOnly: false }, riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'female', placeId: 'P1' }],
      vehicles: [car({ needsFemaleLeader: false })] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml', '_busGradeChip'], `${mkStubs}
const BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
    expect(_busRoutesHtml()).not.toContain('No female leader');
  });
  it('shows the per-car Route button only for a car with riders', () => {
    const v = { run: { readOnly: false }, riders: [{ id: 'r1', runVehicleId: 'rv1', gender: 'male', placeId: 'P1' }],
      vehicles: [car(), { ...car(), id: 'rv2' }] };
    const { _busRoutesHtml } = loadFns(['_busRoutesHtml', '_busGradeChip'], `${mkStubs}\nconst BUS = { view: ${JSON.stringify(v)}, routeMin: {} };`);
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
describe('_busRosterHtml keeps search/Past riders visible during Generate; only readOnly hides them', () => {
  const stubs = `function esc(s) { return String(s); } function icS() { return ''; } function icEmpty() { return ''; }
     function _busSuburb(a) { return a; } function _busConsentChip() { return ''; } function _busCarColour() { return '#000'; }
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
  it('one tap posts the saved addressId', async () => {
    const sent: unknown[] = [];
    const { busAddPast } = loadFns(['busAddPast'], `const BUS = { view: { pastRiders: ${JSON.stringify(past)} } };
      function _busBlockWrite() { return false; }
      async function _busSend(m, url, body) { globalThis.__sent.push([m, url, body]); }
      function toast() {} function renderBus() {}`);
    (globalThis as any).__sent = sent;
    await busAddPast(0);
    expect(sent).toEqual([['POST', '/bus/riders', { studentId: 's1', addressId: 'a1' }]]);
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
      function _busSuburb(a) { return a; }
      function _busPrefGradesChip() { return ''; }
    `;
    return loadFns(['_busCarsHtml', '_busLockedBy'], prelude, ['_busCarsHtml'])._busCarsHtml();
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
describe('busRemoveOwnCarFor removes the car with an ?as=<ownerLeaderId> override (Task 11)', () => {
  it('deletes using the car owner\'s leader id, not the caller\'s own', async () => {
    const prelude = `
      const BUS = { view: { vehicles: [{ id: 'rv1', name: 'Josh\\'s car', ownerLeaderId: 'L9' }] } };
      function esc(s) { return String(s); }
      function _busLocalNow() { return '2026-10-09T19:00'; }
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
    expect(__state().deleted).toContain('as=L9');
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
      function _busReadAddress() { return { addressId: 'a1' }; }
      function _busQs() { return ''; }
      let __posted = null, __sent = [];
      const API = { post: async (url, body) => { __posted = body; return { id: 'g1' }; } };
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
    return loadFns(['_busNewPeopleCard'], prelude)._busNewPeopleCard();
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
      function _busSuburb(a) { return a; }
      function _busConsentChip() { return ''; }
      function _busPinnedIcon() { return ''; }
      function _busFmtTime() { return ''; }
    `;
    return loadFns(['_busMyCarHtml'], prelude)._busMyCarHtml();
  };
  it('tells a plain leader to ask a coordinator', () => {
    expect(mk('leader', false)).toContain('Ask a coordinator to set the church address');
  });
  it('still points a coordinator leader at Bus settings', () => {
    expect(mk('leader', true)).toContain('Set the church address in Bus settings');
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
  it('_busAnalysisHtml puts a "Back to Routes" link at the top, even on error', () => {
    const prelude = `
      const BUS = { analysisErr: 'boom', tab: 'analysis' };
      function esc(s) { return String(s); }
      function icS(k) { return ''; }
    `;
    const html = loadFns(['_busAnalysisHtml'], prelude)._busAnalysisHtml();
    expect(html).toContain('Back to Routes');
    expect(html.indexOf('Back to Routes')).toBeLessThan(html.indexOf('boom'));
  });
  it('the header Analysis button is index.html-sourced and switches class with BUS.tab', () => {
    const html = loadIndexHtml();
    const block = html.slice(html.indexOf('/* ── BUS MODULE ── */'), html.indexOf('/* ── END BUS MODULE ── */'));
    expect(block).toContain("BUS.tab === 'analysis' ? 'btn-primary' : 'btn-secondary'");
  });
});
