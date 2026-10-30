// ID Checks SPA plumbing (Task 12): the nav entry, route guard, Setup switch, logout clearing, cache bypass and the block markers.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, loadFns } from './helpers/extract-fn';
import { navWithModules } from './helpers/module-off';
import { MinistryConfigSchema, MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { ID_CHECK_SECTIONS } from '../core/id-check-questions';

const HTML = loadIndexHtml();
const ROLES = ['admin', 'oversight', 'grade', 'quad', 'leader'];
const DASH = '──';

describe('ID Checks More entry', () => {
  it('oversight and admin get it when the module is on', () => {
    for (const r of ['oversight', 'admin']) expect(navWithModules(r, { idChecks: 'on' }).more, r).toContain('idchecks');
  });
  it('quad, grade and leader never get it', () => {
    for (const r of ['quad', 'grade', 'leader']) expect(navWithModules(r, { idChecks: 'on' }).more, r).not.toContain('idchecks');
  });
  it('nobody gets it while the module is off', () => {
    for (const r of ROLES) {
      const n = navWithModules(r, { idChecks: 'off' });
      expect(Object.values(n).flat(), r).not.toContain('idchecks');
    }
  });
  it('the entry is labelled ID Checks and opens go(idchecks)', () => {
    expect(HTML).toMatch(/id:'idchecks', ic:'id', label:'ID Checks', mbl:'ID Checks', open:"go\('idchecks'\)"/);
  });
});

describe('route guard and dispatch', () => {
  it('all four pages map to the idChecks module', () => {
    const pm: Record<string, string> = new Function(`${HTML.match(/^const PAGE_MODULE = .*$/m)![0]}; return PAGE_MODULE;`)();
    for (const p of ['idchecks', 'idcheck-leader', 'idcheck-edit', 'idcheck-grid']) expect(pm[p], p).toBe('idChecks');
  });
  it('render() sends a not-allowed role or an off module Home and dispatches each page', () => {
    const r = extractFn(HTML, 'render');
    expect(r).toMatch(/p\.indexOf\('idcheck'\) === 0 && !_icOn\(\)\) \{ go\('home'\); return; \}/);
    for (const [p, fn] of [['idchecks', 'renderIdChecks'], ['idcheck-leader', 'renderIdCheckLeader'], ['idcheck-edit', 'renderIdCheckEdit'], ['idcheck-grid', 'renderIdCheckGrid']]) {
      expect(r, p).toContain(`p==='${p}') await ${fn}()`);
    }
  });
  it('_icOn needs the module on and an oversight or admin login', () => {
    const on = (role: string | null, v: string) => loadFns(['_icOn'], `var S = ${JSON.stringify({ user: role ? { role } : null, settings: { ministryConfig: { modules: { idChecks: v } } } })};`)._icOn();
    expect(on('oversight', 'on')).toBe(true);
    expect(on('admin', 'on')).toBe(true);
    expect(on('quad', 'on')).toBe(false);
    expect(on('oversight', 'off')).toBe(false);
    expect(on(null, 'on')).toBe(false);
  });
});

describe('Youth Setup', () => {
  const body = (idChecks: 'on' | 'off', extra = {}) => {
    const cfg = MinistryConfigSchema.parse({ modules: { idChecks }, ...extra });
    const fns = ['esc', '_youthSetupBody', '_setupCard', '_setupElvantoModulesHtml', '_setupFlowHiddenHtml', '_setupIntakeHtml', '_setupModuleMode', '_nyModeOf', '_setupElvCardHtml', '_loginStyleOf', '_setupNoticesHtml', '_modOn'];
    const constOf = (name: string) => { const i = HTML.indexOf('\nconst ' + name + ' = ') + name.length + 10; return new Function('return ' + HTML.slice(i, HTML.indexOf('];', i) + 1))(); };
    // Anything the card calls that is not listed is an inert stub (same approach as baseline-modules.spa.test.ts).
    const env: Record<string, any> = {
      S: { user: { role: 'admin' }, settings: {} }, _setupDraft: cfg, _ensureSetupDraft: () => {}, _setupOpen: {}, _setupFlowSteps: [], MINISTRY_CONFIG_DEFAULTS_CLIENT: cfg,
      _SETUP_ELVANTO: constOf('_SETUP_ELVANTO'), _SETUP_SWITCHES: constOf('_SETUP_SWITCHES'), _DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      _logoModeOverride: null, _setupElv: null, helpTip: () => '', userGrades: () => [], _serviceDayName: () => 'Friday',
    };
    const stub: any = () => '';
    const scope = new Proxy(env, { has: (_t, k) => typeof k === 'string' && !k.startsWith('__') && !(k in globalThis), get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : stub), set: (t, k, v) => { t[k as string] = v; return true; } });
    const src = fns.map((n) => extractFn(HTML, n)).join('\n');
    return new Function('__env', `with (__env) { ${src}\n return _youthSetupBody({}, [{ role: 'admin' }, { role: 'quad' }]); }`)(scope) as string;
  };
  it('the switch is always there; the two rhythm inputs only when on', () => {
    const off = body('off'), on = body('on', { idChecks: { cycleStart: '2026-11-01', intervalMonths: 4 } });
    expect(off).toContain('id="setup-idchecks"');
    expect(off).not.toContain('setup-idchecks-start');
    expect(off).not.toContain('setup-idchecks-months');
    expect(on).toMatch(/id="setup-idchecks" checked/);
    expect(on).toMatch(/type="date"[^>]*id="setup-idchecks-start" value="2026-11-01"/);
    expect(on).toMatch(/type="number"[^>]*id="setup-idchecks-months" min="1" max="12" value="4"/);
    expect(on).toContain("_setupSet('idChecks.cycleStart'");
    expect(on).toContain("_setupSet('idChecks.intervalMonths'");
  });
  it('the client defaults mirror the server defaults', () => {
    const src = HTML.slice(HTML.indexOf('const MINISTRY_CONFIG_DEFAULTS_CLIENT = {'));
    const client = new Function(`${src.slice(0, src.indexOf('\n};') + 3)}\nreturn MINISTRY_CONFIG_DEFAULTS_CLIENT;`)();
    expect(client.modules.idChecks).toBe(MINISTRY_CONFIG_DEFAULTS.modules.idChecks);
    expect(client.idChecks).toEqual(MINISTRY_CONFIG_DEFAULTS.idChecks);
  });
});

describe('logout clears ysc.ic. keys', () => {
  it('removes every ysc.ic.* key and nothing else, and doLogout calls it', () => {
    const store = new Map<string, string>([['ysc.ic.draft.a', '1'], ['ysc.ic.filter', '2'], ['ysc.lkq.u1', 'q'], ['yap_token', 't'], ['ysc.icx', 'keep']]);
    const localStorage = { get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null, removeItem: (k: string) => { store.delete(k); } };
    new Function('localStorage', `${extractFn(HTML, '_icClearLocal')}; _icClearLocal();`)(localStorage);
    expect([...store.keys()].sort()).toEqual(['yap_token', 'ysc.icx', 'ysc.lkq.u1']);
    expect(extractFn(HTML, 'doLogout')).toContain('_icClearLocal();');
  });
  it('a throwing localStorage does not break logout', () => {
    const bad = { get length(): number { throw new Error('blocked'); } };
    expect(() => new Function('localStorage', `${extractFn(HTML, '_icClearLocal')}; _icClearLocal();`)(bad)).not.toThrow();
  });
});

describe('_icGet bypasses the 30 s cache', () => {
  it('drops the cached /id-checks entries before every GET', async () => {
    const deleted: string[][] = [], calls: string[] = [];
    const Cache = { del: (...k: string[]) => { deleted.push(k); } };
    const API = { get: (p: string) => { calls.push(p); return Promise.resolve({ p }); } };
    const f = new Function('Cache', 'API', `${extractFn(HTML, '_icGet')}; return _icGet;`)(Cache, API);
    await f('/id-checks/leaders/abc');
    await f('/id-checks');
    expect(calls).toEqual(['/id-checks/leaders/abc', '/id-checks']);
    expect(deleted).toEqual([['/id-checks'], ['/id-checks']]);
  });
  it('the real Cache.del of /id-checks removes the key and its sub-paths, not other keys', () => {
    const start = HTML.indexOf('const Cache = (() => {');
    const cacheSrc = HTML.slice(start, HTML.indexOf('})();', start) + 5);
    const Cache = new Function(`${cacheSrc}\nreturn Cache;`)();
    for (const k of ['/id-checks', '/id-checks/leaders/a', '/id-checks?x=1', '/id-checks-other', '/students']) Cache.set(k, 1);
    Cache.del('/id-checks');
    expect(['/id-checks', '/id-checks/leaders/a', '/id-checks?x=1', '/students'].map((k) => Cache.get(k))).toEqual([null, null, null, 1]);
  });
});

describe('section heading', () => {
  it('has no trailing dash for a section with no subtitle', () => {
    const f = loadFns(['_icSectionTitle'])._icSectionTitle;
    expect(f({ title: 'General', subtitle: '' })).toBe('General');
    expect(f({ title: 'Faith', subtitle: 'Walk with God' })).toBe('Faith – Walk with God');
    for (const s of ID_CHECK_SECTIONS) expect(f(s).endsWith('– '), s.key).toBe(false);
  });
});

describe('block markers', () => {
  it('the block and the four marker lines each appear exactly once, markers inside the block, in order', () => {
    const start = `/* ${DASH} ID CHECKS MODULE ${DASH} */`, end = `/* ${DASH} END ID CHECKS ${DASH} */`;
    const markers = ['/*IC-LIST*/', '/*IC-EDIT*/', '/*IC-GRID*/', '/*IC-EXPORT*/'];
    for (const m of [start, end, ...markers]) expect(HTML.split(m).length - 1, m).toBe(1);
    const order = [start, ...markers, end].map((m) => HTML.indexOf(m));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const m of markers) expect(HTML.split(/\r?\n/)).toContain(m);
  });
});
