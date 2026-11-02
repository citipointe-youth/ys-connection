import { describe, it, expect, vi } from 'vitest';
import { loadIndexHtml, loadFns } from './helpers/extract-fn';

// The real Cache and API modules from the shipped HTML, on a stubbed fetch.
function apiKit(fetchImpl: (path: string) => Promise<unknown>) {
  const src = loadIndexHtml();
  const cache = src.match(/^const Cache = \(\(\) => \{[\s\S]*?^\}\)\(\);/m)![0];
  const api = src.match(/^const API = \(\(\) => \{[\s\S]*?^\}\)\(\);/m)![0];
  const section = src.match(/^const SECTION_OF = \{[\s\S]*?^\};/m)![0];
  const fetchStub = vi.fn((path: string) => fetchImpl(path));
  // eslint-disable-next-line no-new-func
  const kit = new Function('fetch', `
    const _npStart = () => {}, _npDone = () => {}, _errReport = () => {}, _plainErr = (m, s, c, said) => said, _lsGet = () => 'tok';
    const _errRoute = () => '', _handleAuthExpired = () => {}, S = {};
    ${section}\n${api}\n${cache}\nreturn { API, Cache };`)(fetchStub);
  return { ...kit, fetchStub } as { API: any; Cache: any; fetchStub: typeof fetchStub };
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, statusText: 'x', json: async () => ({}) });

describe('QA 5: Cache.del reaches what /batch brought in', () => {
  it('a batch after an invalidation gets new data, not its own cached reply', async () => {
    let pct = 10;
    const { API, Cache, fetchStub } = apiKit(async () => ok({ results: { overview: { pct } } }));
    await API.batch(['/overview']);
    expect(Cache.get('/overview')).toEqual({ pct: 10 });
    pct = 20; // connecting a student on the server...
    Cache.del('/overview'); // ...and addConnFromPicker's invalidation
    await API.batch(['/overview']);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(Cache.get('/overview')).toEqual({ pct: 20 });
  });

  it('a read in flight across an invalidation does not refill the cache', async () => {
    const releases: ((v: unknown) => void)[] = [];
    const { API, Cache } = apiKit(() => new Promise((r) => { releases.push(r); }));
    const single = API.get('/trends');
    const batch = API.batch(['/overview']);
    Cache.del('/connections');
    releases[0]!(ok({ old: true }));
    releases[1]!(ok({ results: { overview: { old: true } } }));
    await Promise.all([single, batch]);
    expect(Cache.get('/trends')).toBeNull();
    expect(Cache.get('/overview')).toBeNull();
  });
});

describe('QA 22: a failed load is not an empty list', () => {
  it('no answer and nothing known: rejects and remembers; success forgets', async () => {
    let up = false;
    const { API, Cache } = apiKit(async () => { if (!up) throw new TypeError('Failed to fetch'); return ok([1]); });
    await expect(API.get('/students')).rejects.toThrow();
    expect(Cache.failed.has('/students')).toBe(true);
    up = true;
    await API.get('/students');
    expect(Cache.failed.has('/students')).toBe(false);
  });

  it('no answer with a last-known copy: serves that copy', async () => {
    let up = true;
    const { API, Cache } = apiKit(async () => { if (!up) throw new TypeError('Failed to fetch'); return ok(['old']); });
    await API.get('/students');
    Cache.set('/students', ['old']);
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    up = false;
    expect(await API.get('/students')).toEqual(['old']);
    expect(Cache.failed.has('/students')).toBe(false);
    spy.mockRestore();
  });

  it('a 403 is a refusal, not a failed load', async () => {
    const { API, Cache } = apiKit(async () => fail(403));
    await expect(API.get('/import/history')).rejects.toThrow();
    expect(Cache.failed.size).toBe(0);
  });

  it('a screen is blocked only for the paths it needs', () => {
    const { _loadFailedNow } = loadFns(['_pageNeeds', '_loadFailedNow'], `
      var S = { page: 'at-risk', user: { role: 'quad' } }, _msLeader = null;
      const ATRISK_PATHS = ['/students'], CONNECT_PATHS = [], PRAYER_PATHS = [], STUDENTS_PATHS = [], TREND_PATHS = [], IMPORT_PATHS = [], BIRTHDAYS_PATHS = [], ADMIN_PATHS = [], MYSTUDENTS_PATHS = [];
      const HOME_PATHS = () => ['/overview', '/lifegroups/stats'];
      var known = null;
      const Cache = { failed: new Set(['/students', '/lifegroups/stats']), getStale: () => known };`);
    expect(_loadFailedNow()).toBe(true);
    const { _loadFailedNow: home } = loadFns(['_pageNeeds', '_loadFailedNow'], `
      var S = { page: 'home', user: { role: 'quad' } }, _msLeader = null;
      const ATRISK_PATHS = [], CONNECT_PATHS = [], PRAYER_PATHS = [], STUDENTS_PATHS = [], TREND_PATHS = [], IMPORT_PATHS = [], BIRTHDAYS_PATHS = [], ADMIN_PATHS = [], MYSTUDENTS_PATHS = [];
      const HOME_PATHS = () => ['/overview', '/lifegroups/stats'];
      const Cache = { failed: new Set(['/lifegroups/stats']), getStale: () => null };`);
    expect(home()).toBe(false); // Home has its own fallback for lifegroup stats
  });
});

describe('QA 1: sign-in prefetch', () => {
  const paths = (role: string) => {
    const { _prefetch, API } = loadFns(['_prefetch'], `
      var S = { user: { role: '${role}' } };
      const _prayersOn = () => false;
      const API = { batch: (p) => { API.seen = p; } };`, ['_prefetch', 'API']);
    _prefetch();
    return API.seen as string[];
  };
  it('asks for import history only where import:run exists', () => {
    for (const r of ['quad', 'grade', 'leader']) expect(paths(r)).not.toContain('/import/history');
    for (const r of ['admin', 'oversight']) expect(paths(r)).toContain('/import/history');
  });
});

describe('QA 11: dismissing a sheet', () => {
  const kit = () => loadFns(['_moDismiss'], `
    const S = {}; const _inFlight = new Set(); const root = { _typed: false, _armed: 0, contains: (k) => k.inSheet }; let closed = 0, toasts = 0;
    const document = { getElementById: (id) => (id === 'modal-root' ? root : null) };
    const closeModal = () => { closed++; }, toast = () => { toasts++; };
    const peek = () => ({ closed, toasts }); `, ['_moDismiss', 'root', 'peek', '_inFlight']);

  it('untouched closes at once', () => {
    const k = kit();
    k._moDismiss();
    expect(k.peek()).toEqual({ closed: 1, toasts: 0 });
  });
  it('touched asks once, the second gesture discards, and a late one asks again', () => {
    const k = kit();
    k.root._typed = true;
    k._moDismiss();
    expect(k.peek()).toEqual({ closed: 0, toasts: 1 });
    k.root._armed = Date.now() - 600; // past a double tap
    k._moDismiss();
    expect(k.peek()).toEqual({ closed: 1, toasts: 1 });
    k.root._armed = Date.now() - 5000;
    k._moDismiss();
    expect(k.peek()).toEqual({ closed: 1, toasts: 2 });
  });
  it('a double tap does not discard: the second tap within 500 ms is ignored', () => {
    const k = kit();
    k.root._typed = true;
    k._moDismiss();
    k._moDismiss();
    expect(k.peek()).toEqual({ closed: 0, toasts: 1 });
  });
  it("stays open while this sheet's own save is running (_once), not for another save", () => {
    const k = kit();
    const here = { nodeType: 1, inSheet: true };
    k._inFlight.add(here);
    k._moDismiss();
    expect(k.peek()).toEqual({ closed: 0, toasts: 0 });
    k._inFlight.clear();
    k._inFlight.add({ nodeType: 1, inSheet: false });
    k._inFlight.add('login');
    k._moDismiss();
    expect(k.peek()).toEqual({ closed: 1, toasts: 0 });
  });
});

describe('QA 23: opening with no signal', () => {
  // loadFns has no way to pass arguments, so the two replies go through globals on this object.
  const run = async (me: () => Promise<unknown>, settings: () => Promise<unknown>) => {
    const g = globalThis as any;
    g.__me = me; g.__set = settings;
    const k = loadFns(['boot'], `
      var S = { user: null, page: 'home', settings: {} }, _previewStash = null, drew = [];
      var localStorage = { getItem: () => 'tok' };
      const API = { setToken: (t) => { API.t = t; }, t: 'tok', get: (p) => (p === '/auth/me' ? globalThis.__me() : globalThis.__set()) };
      const _isAuthExpired = (e) => !!e && e.status === 401;
      const restoreConnectFilters = () => {}, restoreArFilter = () => {}, restorePrayerFilter = () => {};
      const _settingsFallback = () => { drew.push('fallback'); return { ministryConfig: {} }; }, _bootOffline = () => { drew.push('offline'); };
      const applyTheme = () => {}, render = () => { drew.push('render:' + S.page); }, _reloadViewportFix = () => {};
      var location = { search: '', pathname: '/' }, history = { replaceState() {} };
      const _quadIamPrompt = () => {};`, ['boot', 'API', 'drew', 'S']);
    await k.boot();
    return k;
  };

  it('a saved session and no answer: offline screen, token kept, no setup or sign-in', async () => {
    const k = await run(() => Promise.reject(new Error('no signal')), () => Promise.reject(new Error('no signal')));
    expect(k.drew).toEqual(['fallback', 'offline']);
    expect(k.API.t).toBe('tok');
    expect(k.S.page).toBe('home');
  });
  it('an expired session still goes to sign-in', async () => {
    const k = await run(() => Promise.reject(Object.assign(new Error('x'), { status: 401 })), () => Promise.resolve({}));
    expect(k.API.t).toBeNull();
    expect(k.drew).toEqual(['render:home']);
  });
  it('a server answering 500 with no user still shows the setup screen', async () => {
    const k = await run(() => Promise.reject(Object.assign(new Error('x'), { status: 401 })), () => Promise.reject(Object.assign(new Error('x'), { status: 500 })));
    expect(k.S.page).toBe('setup');
  });
  it('no answer for settings with no session: sign-in, never setup', async () => {
    const k = await run(() => Promise.reject(Object.assign(new Error('x'), { status: 401 })), () => Promise.reject(new Error('no signal')));
    expect(k.S.page).toBe('home');
  });
});

describe('QA 24: session death under a form', () => {
  const kit = (typed: boolean) => loadFns(['_handleAuthExpired'], `
    var _authExpiring = false, _previewStash = null, S = { user: { id: 'u' } }, calls = [];
    const _swTyped = () => ${typed}, _reauthOpen = () => calls.push('reauth'), toast = () => calls.push('out');
    const navReset = () => {}, API = { setToken() {} }, _vgReset = () => {}, _lkSoftReset = () => {}, render = () => {};
    var setTimeout = () => {}; `, ['_handleAuthExpired', 'calls']);
  it('typed text: sign in again on top of it', () => {
    const k = kit(true); k._handleAuthExpired();
    expect(k.calls).toEqual(['reauth']);
  });
  it('nothing typed: the usual sign-out', () => {
    const k = kit(false); k._handleAuthExpired();
    expect(k.calls).toEqual(['out']);
  });
});

describe('QA 27: Youth Setup unsaved changes', () => {
  const kit = () => loadFns(['_setupState', '_setupDirty', '_setupLeaveAsk'], `
    var S = { page: 'admin' }, _adminTab = 'youthsetup', _setupDraft = { a: 1 }, _setupServiceMinAttendance = 100, _setupTermGapDays = 14, _setupClean = null, asked = 0, answer = false;
    const _lkAsk = () => { asked++; return Promise.resolve(answer); };
    const set = (o) => { if ('a' in o) _setupDraft = { a: o.a }; if ('min' in o) _setupServiceMinAttendance = o.min; if ('ans' in o) answer = o.ans; if ('tab' in o) _adminTab = o.tab; };
    const mark = () => { _setupClean = _setupState(); };
    const peek = () => ({ asked, draft: _setupDraft }); `, ['_setupDirty', '_setupLeaveAsk', 'set', 'mark', 'peek']);

  it('clean leaves without asking; a change asks; only Discard leaves', async () => {
    const k = kit(); k.mark();
    const then = vi.fn();
    expect(k._setupLeaveAsk(then)).toBe(false);
    k.set({ min: 50 });
    expect(k._setupDirty()).toBe(true);
    expect(k._setupLeaveAsk(then)).toBe(true);
    await Promise.resolve();
    expect(then).not.toHaveBeenCalled();
    k.set({ ans: true });
    expect(k._setupLeaveAsk(then)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(then).toHaveBeenCalledTimes(1);
    expect(k.peek().draft).toBeNull();
    expect(k._setupDirty()).toBe(false);
  });
  it('another Admin tab is never dirty', () => {
    const k = kit(); k.mark(); k.set({ min: 50, tab: 'accounts' });
    expect(k._setupDirty()).toBe(false);
  });
});
