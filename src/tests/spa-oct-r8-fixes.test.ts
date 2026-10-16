import { describe, it, expect, vi } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

// October rework R8 fixes (triage 2026-10-12): SPA side.

describe('T1 Youth Setup sends a risky switch only when it changed, with expect', () => {
  const f = loadFns(['_setupBaseOf', '_setupPatch']);
  const BASE = { simple: false, prayers: true };

  it('a colour-only save from a stale draft carries no logins and no modules.prayers', () => {
    const draft = { logins: { simple: false, retiredGradeIds: ['x'] }, modules: { prayers: true, busMinistry: true }, branding: { accent: '#f00' } };
    const p = f._setupPatch(draft, BASE);
    expect(p.ministryConfig.logins).toBeUndefined();
    expect(p.ministryConfig.modules).toEqual({ busMinistry: true });
    expect(p.ministryConfig.branding).toEqual({ accent: '#f00' });
    expect(p.expect).toBeUndefined();
    expect(draft.logins.simple).toBe(false); // the draft itself is not changed
  });
  it('a real flip is sent with expect = the value the page opened with', () => {
    const p = f._setupPatch({ logins: { simple: true }, modules: { prayers: false } }, BASE);
    expect(p.ministryConfig.logins).toEqual({ simple: true });
    expect(p.ministryConfig.modules).toEqual({ prayers: false });
    expect(p.expect).toEqual({ simple: false, prayers: true });
  });
  it('a missing modules.prayers in the draft counts as on', () => {
    const p = f._setupPatch({ structure: { gradeMin: 7 } }, BASE);
    expect(p.ministryConfig.modules).toBeUndefined();
    expect(p.expect).toBeUndefined();
  });
  it('saveMinistrySetup PATCHes the trimmed config and expect, then reseeds the draft and base from the saved config', async () => {
    const g = loadFns(['_setupPatch', '_setupBaseOf', 'saveMinistrySetup'],
      `let _setupDraft = { logins: { simple: true }, branding: { accent: '#0f0' } }, _setupBase = { simple: false, prayers: true };
       let _setupServiceMinAttendance = 100, _setupTermGapDays = 14;
       const toasts = []; function toast(m) { toasts.push(m); }
       const S = {}; let _shellReady = false; function _navSig() { return ''; } function _initShell() {} function applyTheme() {}
       const Cache = { del() {} }; let _adminData = { users: [], history: [] };
       const bodies = [];
       const API = { patch: async (p, b) => { bodies.push(b); return { ministryConfig: { logins: { simple: true } }, renamedQuads: 4 }; }, get: async () => ({}) };
       async function renderAdminView() {}
       function __b() { return bodies; } function __d() { return [_setupDraft, _setupBase]; }`,
      ['saveMinistrySetup', '__b', '__d']);
    await g.saveMinistrySetup();
    expect(g.__b()[0].ministryConfig).toEqual({ logins: { simple: true }, branding: { accent: '#0f0' } });
    expect(g.__b()[0].expect).toEqual({ simple: false });
    const [draft, base] = g.__d();
    expect(draft).toEqual({ logins: { simple: true } });
    expect(base).toEqual({ simple: true, prayers: true });
  });
  it('_ensureSetupDraft records the base the page opened with', () => {
    const g = loadFns(['_setupBaseOf', '_ensureSetupDraft'],
      `let _setupDraft = null, _setupBase = null, _setupServiceMinAttendance, _setupTermGapDays, _logoModeOverride; function __b() { return _setupBase; }`,
      ['_ensureSetupDraft', '__b']);
    g._ensureSetupDraft({ ministryConfig: { logins: { simple: true }, modules: { prayers: false } } });
    expect(g.__b()).toEqual({ simple: true, prayers: false });
  });
});

describe('T3/T13 Youth Setup: Grade 6 no longer blocks Junior/Senior logins', () => {
  const { _setupLocks } = loadFns(['_setupLocks']);
  it('Include Grade 6 does not lock turning Simple on, and Simple on does not lock Include Grade 6', () => {
    expect(_setupLocks({ simpleOn: false, includeGrade6: true, cohort: 'grades-quads', quadOn: true })).toEqual({ simple: '' });
    expect(_setupLocks({ simpleOn: true, includeGrade6: false, cohort: 'grades-quads', quadOn: true })).toEqual({ simple: '' });
    expect(_setupLocks({ simpleOn: true, includeGrade6: true, cohort: 'grades-quads', quadOn: true })).toEqual({ simple: '' });
  });
  it('Simple model or Quad off locks turning Simple on with the right next step', () => {
    expect(_setupLocks({ simpleOn: false, cohort: 'none', quadOn: true }).simple).toMatch(/Complex cohort model and the Quad role/);
    expect(_setupLocks({ simpleOn: false, cohort: 'grades-quads', quadOn: false }).simple).toMatch(/Complex cohort model and the Quad role/);
  });
  it('_youthSetupBody uses the Simple lock only, and no text says Years 7 to 12 only', () => {
    const html = loadIndexHtml();
    const body = extractFn(html, '_youthSetupBody');
    expect(body).toContain('_setupLocks(');
    expect(body).not.toMatch(/locks.grade6/);
    expect(body).toMatch(/locks.simple/);
    expect(html).not.toMatch(/Years 7 to 12/);
  });
});

describe('T4 New Year Refresh with Prayers off', () => {
  const load = (o: { prayersOn: boolean; caOn: boolean; wiz: any }) => loadFns(['_wizStepCard', 'renderNewYearWizard'],
    `const S = { settings: { ministryConfig: { modules: { connectionAudit: ${o.caOn} } } } };
     let _wiz = ${JSON.stringify(o.wiz)};
     function _prayersOn() { return ${o.prayersOn}; } function _busOn() { return false; }
     function esc(s) { return String(s); } function icS() { return ''; }`, ['renderNewYearWizard']);
  const WIZ = { step1Done: true, prayersExportDone: false, prayersDeleteOk: false, step2Done: true };

  it('shows an amber warning, not "Skipped"', () => {
    const h = load({ prayersOn: false, caOn: true, wiz: WIZ }).renderNewYearWizard();
    expect(h).toContain('Prayers are switched off but still saved. Turn Prayers on and export them, or tick to confirm they can be deleted.');
    expect(h).toContain('al-warn');
    expect(h).not.toContain('Skipped — Prayers');
  });
  it('Full Reset stays locked until the tick, even with Connection Audit off', () => {
    for (const caOn of [true, false]) {
      expect(load({ prayersOn: false, caOn, wiz: WIZ }).renderNewYearWizard()).not.toContain('wizStep3Confirmed');
      expect(load({ prayersOn: false, caOn, wiz: { ...WIZ, prayersDeleteOk: true } }).renderNewYearWizard()).toContain('wizStep3Confirmed');
    }
  });
  it('Prayers on: unchanged, the export unlocks it', () => {
    expect(load({ prayersOn: true, caOn: false, wiz: WIZ }).renderNewYearWizard()).not.toContain('wizStep3Confirmed');
    expect(load({ prayersOn: true, caOn: false, wiz: { ...WIZ, prayersExportDone: true } }).renderNewYearWizard()).toContain('wizStep3Confirmed');
  });
});

describe('T5/T6/T7 All cars fetches its own list, only while the section is open', () => {
  const PRE = (opts: { fail?: boolean; tab?: string; open?: boolean }) => `
    const BUS = { cars: null, carsErr: false, carsLoading: null, carsOpen: ${!!opts.open}, tab: ${JSON.stringify(opts.tab ?? 'mycar')}, version: 1, pendingRepaint: false, view: null, loading: null, gen: 0 };
    const S = { page: 'bus' }; const document = { hidden: false, getElementById() { return null; } };
    const calls = []; let renders = 0;
    async function _busGet(p) { calls.push(p); if (${!!opts.fail} && p === '/bus/run/cars') throw new Error('x'); if (p === '/bus/run/version') return { version: 1 }; return { cars: [], unassigned: 0 }; }
    function renderBus() { renders++; } function _busEditing() { return false; } function busRefresh() { calls.push('busRefresh'); }
    function esc(s) { return String(s); } function _busCarColour() { return '#000'; } function icS() { return ''; }
    function __c() { return calls; } function __b() { return BUS; } function __r() { return renders; }`;

  it('a failed fetch shows a tap-to-retry line, never an endless Loading', async () => {
    const f = loadFns(['busCarsRefresh', '_busAllCarsHtml', 'progBar'], PRE({ fail: true, open: true }), ['busCarsRefresh', '_busAllCarsHtml', '__b']);
    await f.busCarsRefresh();
    expect(f.__b().carsErr).toBe(true);
    const h = f._busAllCarsHtml();
    expect(h).toContain("Couldn't load the cars. Tap to retry.");
    expect(h).toContain('busCarsRefresh()');
    expect(h).not.toContain('Loading');
  });
  it('a success stores the list and repaints the tab', async () => {
    const f = loadFns(['busCarsRefresh'], PRE({ open: true }), ['busCarsRefresh', '__b', '__r']);
    await f.busCarsRefresh();
    expect(f.__b().cars).toEqual({ cars: [], unassigned: 0 });
    expect(f.__r()).toBe(1);
  });
  it('showing the tab with no list starts a fetch', async () => {
    const f = loadFns(['busCarsRefresh', '_busAllCarsHtml', 'progBar'], PRE({}), ['_busAllCarsHtml', '__c']);
    expect(f._busAllCarsHtml()).toContain('Loading');
    expect(f.__c()).toEqual(['/bus/run/cars']);
  });
  it('a poll tick fetches the cars only while the section is open (version check always)', async () => {
    const f = loadFns(['busCarsRefresh', '_busPollTick'], PRE({ open: true }), ['_busPollTick', '__c', '__b']);
    await f._busPollTick();
    expect(f.__c()).toEqual(['/bus/run/cars', '/bus/run/version']);
    f.__c().length = 0; f.__b().carsOpen = false;
    await f._busPollTick();
    expect(f.__c()).toEqual(['/bus/run/version']);
  });
  it('expanding fetches once; collapsing does not; the section stays open across a repaint', () => {
    const f = loadFns(['busCarsRefresh', 'busCarsToggle', '_busAllCarsSection', '_busAllCarsHtml', 'progBar'], PRE({}), ['busCarsToggle', '_busAllCarsSection', '__c', '__b']);
    expect(f._busAllCarsSection()).not.toContain(' open');
    expect(f._busAllCarsSection()).not.toContain('Loading');
    f.busCarsToggle(true);
    expect(f.__c()).toEqual(['/bus/run/cars']);
    expect(f._busAllCarsSection()).toMatch(/<details[^>]* open /);
    f.busCarsToggle(true); // ontoggle fired by the repaint itself: no second fetch
    expect(f.__c()).toEqual(['/bus/run/cars']);
    f.busCarsToggle(false);
    expect(f.__b().carsOpen).toBe(false);
  });
  it('busRefresh never fetches /bus/run/cars; renderBus has no All cars tab and appends the section to My car only for canSeeCars', () => {
    const src = loadIndexHtml();
    expect(extractFn(src, 'busRefresh')).not.toContain('/bus/run/cars');
    const rb = extractFn(src, 'renderBus');
    expect(rb).not.toContain('allcars');
    expect(rb).toContain("mycar: () => _busMyCarHtml() + (v.canSeeCars ? _busAllCarsSection() : '')");
  });
  it('a null stop shows no number; long names sit in a block element so the ellipsis works', () => {
    const f = loadFns(['_busAllCarsHtml', 'progBar'], `const BUS = { cars: { unassigned: 0, cars: [{ name: 'C', colourIndex: 0, leaderNames: [],
      stops: [{ stop: null, name: 'Maximilian Throckmorton-Wellington', grade: 9, suburb: 'Carina', dropped: false }] }] } };
      function esc(s) { return String(s); } function _busCarColour() { return '#000'; } function icS() { return ''; }`);
    const h = f._busAllCarsHtml();
    expect(h).not.toContain('null');
    expect(h).toContain('<div class="li-title">Maximilian Throckmorton-Wellington</div>');
  });
  it('no cars running still shows how many riders are not on a car', () => {
    const f = loadFns(['_busAllCarsHtml', 'progBar'], `const BUS = { cars: { unassigned: 3, cars: [] } }; function esc(s) { return String(s); }`);
    expect(f._busAllCarsHtml()).toContain('3 not on a car yet.');
  });
});

describe('T7/T8 grade filter repaints from the cache', () => {
  const PRE = (page: string) => `
    const S = { page: ${JSON.stringify(page)}, user: { role: 'quad', quad: 'b79' }, settings: { ministryConfig: { logins: { simple: true } } } };
    const log = []; let _prayerCache = ['p'];
    function render() { log.push('render'); } function renderConnectView() { log.push('connect'); } function renderStudentView() { log.push('students'); }
    function _renderHomeInner(stale, keep) { log.push('home ' + stale + ' ' + keep); } function setApp(h) { log.push('setApp ' + h); }
    function shell(h) { return h; } function _prayersHtml(l) { return 'prayers ' + l.length; }
    function renderHomeFollowup() { log.push('followup'); }
    function __l() { return log; }`;
  it('_vgRepaint dispatches per page without the page loader', () => {
    const cases: [string, string][] = [['leaders', 'connect'], ['students', 'students'], ['home', 'home true true'], ['prayers', 'setApp prayers 1'], ['at-risk', 'render'], ['birthdays', 'render']];
    for (const [page, want] of cases) {
      const f = loadFns(['_vgRepaint'], PRE(page), ['_vgRepaint', '__l']);
      f._vgRepaint();
      expect(f.__l(), page).toEqual([want]);
    }
  });
  it('_vgSet repaints with _vgRepaint, not render()', () => {
    const body = extractFn(loadIndexHtml(), '_vgSet');
    expect(body).toContain('_vgRepaint()');
    expect(body).not.toMatch(/\brender\(\)/);
  });
  it('a failed save reverts the filter, repaints and says why', async () => {
    const f = loadFns(['_vgSave'], `let _vgLocal = { L1: [8] }; const msgs = []; let reps = 0;
      const API = { patch: async () => { throw new Error('No connection'); } };
      function _vgLeader() { return null; } function toast(m) { msgs.push(m); } function _vgRepaint() { reps++; }
      function __s() { return { _vgLocal, msgs, reps }; }`, ['_vgSave', '__s']);
    await f._vgSave('L1');
    const s = f.__s();
    expect(s._vgLocal).toEqual({});
    expect(s.reps).toBe(1);
    expect(s.msgs[0]).toMatch(/No connection/);
  });
  it('picking or clearing "I am" on Home repaints the filter bar and tiles when the filter is active', async () => {
    for (const active of [true, false]) {
      // "I am" changes go through the link branch's guard (_lkSwitchLeader), which calls setMyLeaderId.
      const f = loadFns(['chooseHomeLeader', '_homeIdChanged', '_homeNotYou'], `const log = []; const document = { getElementById() { return { value: 'L1' }; } };
        function setMyLeaderId(v) { log.push('set ' + v); } async function _lkSwitchLeader(v) { setMyLeaderId(v); return true; }
        function _vgActive() { return ${active}; }
        function _vgRepaint() { log.push('repaint'); } function renderHomeFollowup() { log.push('followup'); } function __l() { return log; }`,
        ['chooseHomeLeader', '_homeIdChanged', '_homeNotYou', '__l']);
      await f.chooseHomeLeader();
      await f._homeNotYou();
      expect(f.__l()).toEqual(active ? ['set L1', 'repaint', 'set null', 'repaint'] : ['set L1', 'followup', 'set null', 'followup']);
    }
    expect(extractFn(loadIndexHtml(), 'renderHomeFollowup')).toContain('onclick="_homeNotYou()"');
  });
  it('renderHomeFollowup(true) reads the follow-up from the cache, with no network call', async () => {
    const f = loadFns(['renderHomeFollowup'], `
      const host = { innerHTML: '' }; const document = { getElementById() { return host; } };
      const S = { user: { role: 'quad' } }; let _homeBirthdaysCtx = null; const calls = [];
      function getMyLeaderId() { return 'L1'; }
      const Cache = { getStale(p) { return p === '/connections/leader/L1/followup' ? { leader: { id: 'L1', fullName: 'Tom' }, notSeenService: [], notSeenGroup: [] } : null; } };
      const API = { get: async (p) => { calls.push(p); return null; } };
      function helpTip() { return ''; } function esc(s) { return String(s); } function _serviceDayName() { return 'Friday'; } function _fridayLabel() { return ''; }
      function L(k) { return k; } function _followupListHtml(t) { return '[' + t + ']'; } function _smsTemplateBoxHtml() { return ''; }
      function _lkHomeFlows() {}
      function __s() { return { host, calls }; }`, ['renderHomeFollowup', '__s']);
    await f.renderHomeFollowup(true);
    expect(f.__s().calls).toEqual([]);
    expect(f.__s().host.innerHTML).toContain('Follow Up · Tom');
  });
  it('the hint on Home points below; elsewhere it points to Home', () => {
    const mk = (page: string) => loadFns(['_vgBar'], `const S = { page: '${page}', user: { role: 'quad', quad: 'b79' } };
      function _vgActive() { return true; } function quadGrades() { return [7, 8, 9]; } function getMyLeaderId() { return null; }
      const Cache = { getStale() { return []; } }; function _vgGrades() { return null; } function esc(s) { return String(s); } function _gradeWord() { return 'Year'; }`);
    expect(mk('home')._vgBar()).toContain('Pick who you are below to use your grades');
    expect(mk('at-risk')._vgBar()).toContain('Pick who you are on Home to use your grades');
  });
  it('the bar is a labelled group; disabled chips are not shown as selected', () => {
    const f = loadFns(['_vgBar'], `const S = { page: 'home', user: { role: 'quad', quad: 'b79' } };
      function _vgActive() { return true; } function quadGrades() { return [7, 8, 9]; } function getMyLeaderId() { return null; }
      const Cache = { getStale() { return []; } }; function _vgGrades() { return null; } function esc(s) { return String(s); } function _gradeWord() { return 'Year'; }`);
    const h = f._vgBar();
    expect(h).toContain('role="group"');
    expect(h).not.toContain('fc on');
  });
});

describe('T9 the Bus nav slot label is raw (renderers escape it once) and short on the bottom bar', () => {
  it('a label with <img onerror> stays raw in the slot; mbl is Bus', () => {
    const f = loadFns(['moreItems', '_navSlots'], `const S = { user: { role: 'admin' } };
      const _lbl = '<img src=x onerror=alert(1)>'; function L(k) { return k === 'busMinistry' ? _lbl : k; }
      function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
      function _prayersOn() { return false; } function _busOn() { return true; } function _nyOn() { return false; } function _linkOn() { return false; } function _linkAdminOn() { return false; }
      function _navItemsBase() { return [{ id: 'home' }, { id: 'prayers' }]; }`);
    const slot = f._navSlots()[1];
    expect(slot.label).toBe('<img src=x onerror=alert(1)>'); // no pre-escape: _initShell, home quick actions and leader home esc() it once
    expect(slot.mbl).toBe('Bus');
  });
});

describe('T10 grade chips are 40 px touch targets', () => {
  it('the coarse-pointer block sizes .vg-bar .fc', () => {
    expect(loadIndexHtml()).toMatch(/@media\(pointer:coarse\)\{[^}]*\}?[^@]*\.vg-bar \.fc\{min-height:40px;min-width:31px\}/); // I1: 30% narrower, height kept
  });
});

describe('R8 SPA minors', () => {
  it('the confirm hides the Bus coordinator lines while Bus is off', () => {
    const run = (bus: boolean) => {
      const f = loadFns(['_setupRiskyDiff', 'confirmSaveMinistrySetup'], `
        let _adminData = { settings: { ministryConfig: { modules: { busMinistry: ${bus} } } }, users: [{ role: 'grade', status: 'active' }] };
        let _setupDraft = { logins: { simple: true }, modules: { busMinistry: ${bus} } };
        let html = ''; function modal(h) { html = h; } function __h() { return html; }`, ['confirmSaveMinistrySetup', '__h']);
      f.confirmSaveMinistrySetup();
      return f.__h();
    };
    expect(run(false)).not.toMatch(/Bus/);
    expect(run(true)).toMatch(/No Bus coordinators are set/);
    expect(run(false)).toContain('switches off the 1 grade logins');
  });
  it('a stale /prayers MODULE_DISABLED only goes home from the prayers page', async () => {
    const run = async (page: string) => {
      const log: string[] = [];
      (globalThis as any).__mlog = log;
      const f = loadFns(['_moduleDisabledRefresh'], `let S = { page: '${page}', settings: {} }; let _shellReady = false; let _mdBusy = false;
        const Cache = { del() {} }; const API = { get: async () => ({}) };
        function _navSig() { return 'a'; } function _initShell() {} function go(p) { globalThis.__mlog.push('go ' + p); } function render() { globalThis.__mlog.push('render'); }`);
      await f._moduleDisabledRefresh();
      return log;
    };
    expect(await run('prayers')).toEqual(['go home']);
    expect(await run('my-students')).toEqual(['render']);
  });
  it('doLogout and the auth-expired paths drop unsaved grade taps', () => {
    const src = loadIndexHtml();
    expect(extractFn(src, 'doLogout')).toContain('_vgReset()');
    expect(extractFn(src, '_handleAuthExpired').match(/_vgReset\(\)/g)?.length).toBe(2);
    expect(extractFn(src, '_handleAuthExpired')).toMatch(/setMyLeaderId\(null\)/);
  });
  it('the Prayers-off dialog offers Download CSV only when Prayers is saved on', () => {
    const run = (on: boolean) => {
      const f = loadFns(['_setupPrayersToggle'], `let html = ''; function modal(h) { html = h; } function _setupSet() {}
        function _prayersOn() { return ${on}; } function __h() { return html; }`, ['_setupPrayersToggle', '__h']);
      f._setupPrayersToggle({ checked: false });
      return f.__h();
    };
    expect(run(true)).toContain('exportPrayersCSV()');
    expect(run(false)).not.toContain('exportPrayersCSV()');
    expect(run(true)).toContain('Press Save Youth Setup to apply');
  });
});

vi.useRealTimers();

describe('T1 admin tabs: pills on desktop, a <select> under 768px, one shared list', () => {
  const f = loadFns(['_adminTabsHtml'], `const ADMIN_TABS = [['import','Import'],['x','A <b> tab']]; function esc(s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'); }`);
  it('every tab appears in both the pill strip and the select; current one is on/selected; labels escaped', () => {
    const h = f._adminTabsHtml('x');
    expect(h).toContain('<select');
    expect(h).toContain("switchAdminTab('import')");
    expect(h).toContain('<option value="import">');
    expect(h).toMatch(/<option value="x" selected>/);
    expect(h).toMatch(/tbbtn on" onclick="switchAdminTab\('x'\)"/);
    expect(h).not.toContain('<b>');
  });
  it('the real ADMIN_TABS list and the mobile-only CSS are shipped; renderAdminView uses the helper', () => {
    const src = loadIndexHtml();
    expect(src).toMatch(/const ADMIN_TABS = \[\['import','Import'\][^;]*\['system','System check'\],\['errors','Error log'\],\['unsent','Unsent new people'\],\['link','Elvanto link'\]\];/);
    expect(src).toMatch(/@media\(max-width:767px\)\{\.admin-tabs\{display:none\}\.admin-tabsel\{display:block\}\}/);
    expect(extractFn(src, 'renderAdminView')).toContain('_adminTabsHtml(_adminTab)');
  });
  it('2026-10-14: the Elvanto link tab opens its own page with the same tab list; another tab from there goes back to Admin', async () => {
    const src = loadIndexHtml();
    expect(extractFn(src, 'renderLinkAdmin')).toContain("_adminTabsHtml('link')");
    const gone: string[] = [];
    const S = { page: 'admin' };
    const t = new Function('S', 'go', `let _adminTab = 'import'; function _wizReset() {}
${extractFn(src, 'switchAdminTab')}
return { sw: switchAdminTab, tab: () => _adminTab };`)(S, (p: string) => gone.push(p));
    await t.sw('link');
    expect(gone).toEqual(['link-admin']);
    S.page = 'link-admin';
    await t.sw('errors');
    expect(gone).toEqual(['link-admin', 'admin']);
    expect(t.tab()).toBe('errors');
  });
});
