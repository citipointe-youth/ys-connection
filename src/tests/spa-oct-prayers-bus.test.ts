import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const cfg = (mc: any) => `const S = { user: { role: 'admin' }, settings: { ministryConfig: ${JSON.stringify(mc)} } };`;

describe('S2.1 Prayers off', () => {
  it('_prayersOn is true with an empty config and false when modules.prayers is false', () => {
    expect(loadFns(['_prayersOn'], cfg({}))._prayersOn()).toBe(true);
    expect(loadFns(['_prayersOn'], cfg({ modules: { prayers: false } }))._prayersOn()).toBe(false);
  });
  it('moreItems leaves Prayers out when off', () => {
    const pre = (p: boolean) => `${cfg({})}
function _prayersOn() { return ${p}; } function _busOn() { return true; } function _nyOn() { return false; } function _linkOn() { return false; } function _linkAdminOn() { return false; } function L(k) { return k; }`;
    expect(loadFns(['moreItems'], pre(true)).moreItems().map((m: any) => m.id)).toEqual(['prayers', 'bus']);
    expect(loadFns(['moreItems'], pre(false)).moreItems().map((m: any) => m.id)).toEqual(['bus']);
  });
  it('render sends the prayers page home when off', () => {
    const src = extractFn(loadIndexHtml(), 'render');
    expect(src).toMatch(/p === 'prayers' && !_prayersOn\(\)/);
  });
  it('_prefetch drops /prayers when off', () => {
    const calls: string[][] = [];
    (globalThis as any).__c = calls;
    const mk = (on: boolean) => loadFns(['_prefetch'], `const API = { batch: (a) => { globalThis.__c.push(a); } }; function _prayersOn() { return ${on}; }`);
    mk(true)._prefetch();
    mk(false)._prefetch();
    expect(calls[0]).toContain('/prayers');
    expect(calls[1]).not.toContain('/prayers');
  });
  it('the MODULE_DISABLED handler refetches /settings, rebuilds the shell when the nav changed, then leaves the prayers page', async () => {
    const log: string[] = [];
    (globalThis as any).__log = log;
    const pre = `let sig = 'a'; let S = { page: 'prayers', settings: { old: 1 } }; let _shellReady = true; let _mdBusy = false;
const Cache = { del: (k) => globalThis.__log.push('del ' + k) };
const API = { get: async (p) => { globalThis.__log.push('get ' + p); sig = 'b'; return { fresh: 1 }; } };
function _navSig() { return sig; } function _initShell() { globalThis.__log.push('shell'); } function go(p) { globalThis.__log.push('go ' + p); }
function __s() { return S; }`;
    const f = loadFns(['_moduleDisabledRefresh'], pre, ['_moduleDisabledRefresh', '__s']);
    await f._moduleDisabledRefresh();
    expect(log).toEqual(['del /settings', 'get /settings', 'shell', 'go home']);
    expect(f.__s().settings).toEqual({ fresh: 1, }); expect(f.__s().page).toBe('prayers');
  });
  it('the API wrapper calls the handler on MODULE_DISABLED from a prayers path', () => {
    const html = loadIndexHtml();
    expect(html).toMatch(/e\.code === 'MODULE_DISABLED' && [^\n]*_moduleDisabledRefresh\(\)/);
    expect(html).toContain("/^\\/prayers/.test(path)");
  });
  it('the Prayers toggle asks to export first and only turns off on confirm', () => {
    const calls: string[] = [];
    (globalThis as any).__k = calls;
    const pre = `function modal(h) { globalThis.__k.push('modal:' + h); } function closeModal() {}
function _setupSet(p, v) { globalThis.__k.push('set ' + p + '=' + v); } function _prayersOn() { return true; }`;
    const f = loadFns(['_setupPrayersToggle', '_setupPrayersOff'], pre);
    const el = { checked: false };
    f._setupPrayersToggle(el);
    expect(el.checked).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('Export prayers first?');
    expect(calls[0]).toContain('exportPrayersCSV()');
    f._setupPrayersToggle({ checked: true });
    expect(calls[1]).toBe('set modules.prayers=true');
    f._setupPrayersOff();
    expect(calls[2]).toBe('set modules.prayers=false');
  });
  it('the Modules card has the toggle; My Connections and the profile hide prayer controls', () => {
    const html = loadIndexHtml();
    expect(html).toContain('_setupPrayersToggle(this)');
    expect(html).toMatch(/if \(_prayersOn\(\)\) try \{ prayers = await API\.get\('\/prayers'\)/);
    expect(html).toMatch(/\$\{_prayersOn\(\) \? `<button class="btn btn-secondary btn-sm" onclick="openPrayerModal/);
  });
  it('New Year Refresh counts Prayers as done and skipped when off', () => {
    const src = extractFn(loadIndexHtml(), 'renderNewYearWizard');
    expect(src).toContain('prayersOn');
    expect(src).toMatch(/prayersSatisfied/);
  });
});

describe('S2.2 _navSlots', () => {
  const base = (role: string) => {
    const mk = (id: string) => ({ id, ic: id, label: id });
    const a = role === 'leader'
      ? ['home', 'prayers', 'at-risk', 'my-students', 'birthdays']
      : ['home', 'at-risk', 'prayers', 'leaders', 'admin', 'trends', 'students'];
    return a.map(mk);
  };
  const run = (role: string, o: { prayers: boolean; bus: boolean; ny: boolean; link?: boolean }) => {
    const pre = `const S = { user: { role: '${role}' } }; function L(k) { return k; } function esc(s) { return String(s); }
function _prayersOn() { return ${o.prayers}; } function _busOn() { return ${o.bus}; } function _nyOn() { return ${o.ny}; } function _linkOn() { return ${!!o.link}; } function _linkAdminOn() { return ${!!o.link && role === 'admin'}; }
function _navItemsBase() { return ${JSON.stringify(base(role))}; }`;
    return loadFns(['moreItems', 'navItems', '_navSlots', 'bottomNavItems', 'quickActionItems'], pre);
  };
  const ids = (xs: any[]) => xs.map((x) => x && x.id);
  for (const role of ['leader', 'grade', 'quad', 'director', 'admin']) {
    it(`slot rules hold for ${role}`, () => {
      expect(ids(run(role, { prayers: true, bus: true, ny: false }).navItems())).toContain('more');
      const alone = run(role, { prayers: true, bus: false, ny: false }).navItems();
      expect(ids(alone)).toContain('prayers');
      expect(ids(alone)).not.toContain('more');
      const bus = run(role, { prayers: false, bus: true, ny: false }).navItems();
      expect(bus.find((x: any) => x.id === 'bus')).toMatchObject({ id: 'bus', ic: 'bus', label: 'busMinistry' });
      expect(ids(bus)).not.toContain('prayers');
      const ny = run(role, { prayers: false, bus: false, ny: true }).navItems();
      expect(ny.find((x: any) => x.id === 'new-youth')).toMatchObject({ ic: 'plus', label: 'New person', action: 'nyOpen()' });
      expect(ids(run(role, { prayers: false, bus: true, ny: true }).navItems())).toContain('more');
    });
  }
  it('Elvanto link merge: with Prayers off, the link entries count toward More', () => {
    for (const role of ['leader', 'grade', 'quad', 'director', 'admin']) {
      const r = run(role, { prayers: false, bus: false, ny: true, link: true });
      expect(ids(r.navItems())).toContain('more');
      expect(ids(r.moreItems())).not.toContain('prayers');
      expect(ids(r.moreItems())).toContain('link-checkin');
    }
  });
  it('no slot: bottom bar drops to 4 and the quick actions do not move up', () => {
    const withSlot = run('admin', { prayers: true, bus: false, ny: false });
    const none = run('admin', { prayers: false, bus: false, ny: false });
    expect(none._navSlots()[2]).toBeNull();
    expect(ids(none.bottomNavItems())).toEqual(['home', 'at-risk', 'leaders', 'admin']);
    expect(none.quickActionItems()).toEqual(withSlot.quickActionItems());
    expect(run('leader', { prayers: false, bus: false, ny: false }).bottomNavItems()).toHaveLength(4);
  });
});

describe('S2.3 Bus All cars', () => {
  const PRE = `function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); } function _busCarColour(i) { return '#000'; } function icS() { return ''; }`;
  const cars = {
    serviceDate: '2026-10-09', version: 1, readOnly: false, unassigned: 2,
    cars: [{
      name: '<b>Car</b>', colourIndex: 0, leaderNames: ['<i>Lee</i>'],
      stops: [
        { stop: 1, name: '<b>Ann</b>', grade: 9, suburb: '<u>Carina</u>', dropped: true },
        { stop: 2, name: 'Bo', grade: null, suburb: 'Camp Hill', dropped: false },
      ],
    }],
  };
  it('_busAllCarsHtml escapes names and suburbs, ticks dropped, and has no buttons', () => {
    const g = loadFns(['_busAllCarsHtml', 'progBar'], `const BUS = { cars: ${JSON.stringify(cars)} }; ${PRE}`);
    const h = g._busAllCarsHtml();
    for (const raw of ['<b>', '<i>', '<u>']) expect(h).not.toContain(raw);
    expect(h).toContain('&lt;b&gt;Car&lt;/b&gt;');
    expect(h).toContain('&lt;b&gt;Ann&lt;/b&gt;');
    expect(h).toContain('&lt;u&gt;Carina&lt;/u&gt;');
    expect(h).toContain('&lt;i&gt;Lee&lt;/i&gt;');
    expect(h).toContain('Camp Hill');
    expect(h).toContain('bus-dropped-tick');
    expect(h).not.toMatch(/<button|onclick/);
  });
  it('_busAllCarsHtml shows a loading line before the data arrives', () => {
    const g = loadFns(['_busAllCarsHtml', 'progBar'], `const BUS = { cars: null, carsErr: false, carsLoading: null }; function busCarsRefresh() {} ${PRE}`);
    expect(g._busAllCarsHtml()).toContain('Loading');
  });
  it('renderBus has no All cars tab (T7); the section is a collapsed <details> labelled All cars (n)', () => {
    expect(extractFn(loadIndexHtml(), 'renderBus')).not.toContain("id: 'allcars'");
    const g = loadFns(['_busAllCarsSection', '_busAllCarsHtml', 'progBar'], `const BUS = { carsOpen: true, cars: ${JSON.stringify(cars)} }; ${PRE}`);
    const h = g._busAllCarsSection();
    expect(h).toContain('<details');
    expect(h).toContain('All cars (1)');
    expect(h).toContain('&lt;b&gt;Ann&lt;/b&gt;');
  });
  it('busRefresh never fetches /bus/run/cars (All cars has its own fetch) and keeps it out of BUS.view', async () => {
    const calls: string[] = [];
    (globalThis as any).__bc = calls;
    const pre = `const BUS = { view: null, myCar: null, loading: null, loadingAs: null, gen: 0, failed: false, routeMin: {}, tab: 'mycar', cars: null, version: -1 };
const S = { user: null, page: 'x' };
function getMyLeaderId() { return null; } function toast() {} function renderBus() {} function renderHome() {} function _busEditing() { return false; }
async function _busGet(p) { globalThis.__bc.push(p); if (p === '/bus/run') return { run: { id: 'r', version: 1 }, canSeeCars: true }; if (p === '/bus/run/cars') return { cars: [] }; return {}; }
function __b() { return BUS; }`;
    const f = loadFns(['busRefresh', '_busTripQs', '_busTripDate', '_busToday', '_busLocalNow'], pre, ['busRefresh', '__b']);
    await f.busRefresh();
    expect(calls).not.toContain('/bus/run/cars');
    expect(f.__b().cars).toBeNull();
    expect(f.__b().view.cars).toBeUndefined();
    expect(f.__b().view.canSeeCars).toBe(true);
    calls.length = 0;
    f.__b().tab = 'mycar';
    await f.busRefresh();
    expect(calls).not.toContain('/bus/run/cars');
  });
  it('doLogout clears BUS.cars', () => {
    expect(extractFn(loadIndexHtml(), 'doLogout')).toMatch(/BUS\.cars = null/);
  });
  it('the cars view code never touches phones, streets or addresses', () => {
    expect(extractFn(loadIndexHtml(), '_busAllCarsHtml')).not.toMatch(/phone|mobile|street|address|unit/i);
  });
});

describe('S2.4 service worker', () => {
  it('CACHE moved off ysc-v89', () => {
    const sw = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
    expect(sw).not.toMatch(/CACHE\s*=\s*'ysc-v89'/);
    expect(sw).toMatch(/CACHE\s*=\s*'ysc-v\d+'/);
  });
});
