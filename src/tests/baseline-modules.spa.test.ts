// Modular-setup Task 0.2: the "live install unchanged" golden (lane Y0). Every later phase of the modular-setup program is
// gated on this file passing with an unchanged src/tests/fixtures/baseline-nav.json (apart from the additive changes the
// plan lists). It records, for the LIVE module states (fixtures/live-modules.json), what each role is offered:
//   BL1  nav / bottom bar / More / quick actions / Admin tabs per role, plus the in-page gated blocks (Home, Bus, Youth
//        Setup cards, error-log groups). Element ids, onclick targets, headings and short table-cell / tile labels (td:service,
//        td:smallGroupPlural, Seen, Weekly); no sentences and no figures.
//        Known limits: leader Home has no cards by design (tiles only); the Needs-attention lines come from a hand-built
//        count object, so a gate inside _attnCounts shows only through the recorded routes; the flows card is stubbed
//        (its id is recorded, not its content); SPA page renderers are covered through nav ids, not listed.
//   BL2  the API route table (method + path, sorted).
//   BL3  MinistryConfigSchema.parse({modules: LIVE_MODULES}).modules.
// Regenerate (reviewed golden diff only): UPDATE_BASELINE=1 npx vitest run src/tests/baseline-modules.spa.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIndexHtml, extractFn, withPlain } from './helpers/extract-fn';
import { MinistryConfigSchema } from '../core/ministry-config';
import { buildContainer } from '../container';
import { ERROR_CATEGORIES } from '../repositories/interfaces/error-log.repository';
import { ERROR_TIERS, TEXT, CLIENT } from '../services/error-log-text';
import { buildRoutes } from '../api/http/router';
import LIVE_MODULES from './fixtures/live-modules.json';

const HTML = loadIndexHtml();
const GOLDEN = join(__dirname, 'fixtures', 'baseline-nav.json');
// The five roles render the same for live: the harness takes the role as a parameter (live has the grade role off and
// Junior/Senior logins on, but a later phase may turn either back on).
const ROLES = ['admin', 'director', 'grade', 'quad', 'leader'] as const;
const MINISTRY_CONFIG = () => MinistryConfigSchema.parse({ modules: LIVE_MODULES });

// ---------- BL1a: nav ----------
const NAV_FNS = ['_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', '_busOn', '_prayersOn', '_modOn', 'moreItems', '_navItemsBase',
  '_navSlots', 'navItems', 'bottomNavItems', 'quickActionItems', '_navClick'];
function navFor(role: string) {
  const fns = new Function('S', 'L', 'modal', 'icN', 'esc', `${withPlain(NAV_FNS.map((x) => extractFn(HTML, x)).join('\n'))};
    return { navItems, bottomNavItems, moreItems, quickActionItems };`)(
    { user: { role }, page: 'home', settings: { ministryConfig: MINISTRY_CONFIG() } }, (k: string) => k, () => {}, (k: string) => `<i ${k}>`, (x: string) => x);
  const idl = (xs: any[]) => xs.map((i) => ({ id: i.id, label: i.label }));
  return {
    navItems: idl(fns.navItems()),
    bottomNavItems: fns.bottomNavItems().map((i: any) => i.id),
    moreItems: fns.moreItems().map((i: any) => i.id),
    quickActionItems: fns.quickActionItems().map((i: any) => i.id),
  };
}

// ---------- BL1b: in-page blocks ----------
// The page renderers are run for real (their source is cut out of public/index.html) in a `with` scope whose unknown names
// resolve to a do-nothing stub; what the test supplies is the fake S and fake replies. Output is reduced to keys: element
// ids, the call each onclick makes (go('x'), switchAdminTab('x'), ...), and .sh / .el-h headings. No sentences.
const NOOP: any = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? () => [][Symbol.iterator]() : k === 'then' ? undefined : NOOP),
  apply: () => '',
});
function scope(env: Record<string, any>) {
  return new Proxy(env, {
    has: (_t, k) => typeof k === 'string' && !k.startsWith('__') && !(k in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : NOOP),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
}
/** Runs the named index.html functions in a stubbed scope and returns what `call` (an async body) returns. */
async function runIn(names: string[], env: Record<string, any>, call: string): Promise<any> {
  const src = names.map((n) => extractFn(HTML, n)).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('__env', `with (__env) { ${src}\n return (async () => { ${call} })(); }`)(scope(env));
}
/** Reduces rendered HTML to ids, onclick calls and headings, in page order. */
function keys(html: string): string[] {
  const out: string[] = [];
  const re = /\bid="([^"]+)"|on(?:click|change)="([A-Za-z_.]+)(?:\(([^)]*)\))?|class="(?:sh|el-h|bt-label|tbbtn[^"]*|ph-title)"[^>]*>([^<]+)|<(?:td|th)[^>]*>\s*([A-Za-z][^<]*?)\s*<\/(?:td|th)>/g;
  for (let m; (m = re.exec(html)); ) out.push(m[1] ? `#${m[1]}` : m[2] ? `${m[2]}(${(m[3] || '').replace(/&#39;/g, "'")})` : m[5] ? `td:${m[5]}` : `h:${(m[4] ?? "").trim()}`);
  return out;
}

const CAPTURE = { out: '' };
const baseEnv = (role: string, extra: Record<string, any> = {}) => ({
  S: { user: { id: 'u1', role, displayName: 'Name', quad: 'g79', grade: 8 }, page: 'home', settings: { ministryConfig: MINISTRY_CONFIG() } },
  L: (k: string) => k, esc: (s: any) => String(s), icN: (k: string) => `<i ${k}>`, icS: (k: string) => `<i ${k}>`,
  setApp: (h: string) => { CAPTURE.out = h; }, shell: (h: string) => h,
  ...extra,
});

const students = [
  { id: 's1', grade: 8, gender: 'female', quad: 'g79', svcAttended: 2, svcTotal: 3, grpAttended: 1, grpTotal: 2, prevSvcAttended: 1, prevSvcTotal: 3, prevGrpAttended: 1, prevGrpTotal: 2 },
  { id: 's2', grade: 11, gender: 'male', quad: 'b1012', svcAttended: 1, svcTotal: 3, grpAttended: 1, grpTotal: 2, prevSvcAttended: 1, prevSvcTotal: 3, prevGrpAttended: 0, prevGrpTotal: 2 },
];
const lgGrade = (grade: number) => ({ grade, current: { uniqueAttenders: 1, avgPerWeek: 1, members: 1 }, previous: { uniqueAttenders: 0, avgPerWeek: 0, members: 0 }, lifegroups: [] });
const REPLIES: Record<string, any> = {
  '/overview': { ministryTotal: 2, atRiskTotal: 1, byGrade: [{ grade: 8, totalStudents: 1, connectedStudents: 0 }], byQuad: [{ quad: 'g79', totalStudents: 1 }, { quad: 'b1012', totalStudents: 1 }] },
  '/trends': { ministry: { averageAttendance: 1 }, byQuad: [], byGrade: [] },
  '/students': students,
  '/lifegroups/stats': { overall: { current: { avgPerWeek: 1 }, previous: { avgPerWeek: 0 } }, byGrade: [lgGrade(8), lgGrade(11)],
    byQuad: [{ quad: 'g79', current: { uniqueAttenders: 1, members: 1, avgPerWeek: 1 }, grades: [lgGrade(8)] }] },
  '/connections': [], '/notices': [],
};
const HOME_FNS = ['_renderHomeInner', 'renderLeaderHome', '_homeTiles', '_homeCheckinTile', '_attnSlot', '_attnMine', '_attnHtml', '_attnLines',
  '_busHomeTile', '_busNewPeopleCard', '_noticesOn', '_noticeHomeHtml', '_homeGradeBar', '_hAttTile', '_lgGradeBlock', 'quadGrades', 'quadGender',
  'quadLabel', '_hQuadGrades', '_gsfx', '_loginGender', '_scopedWeeklyBirthdays', '_isBirthdayInWeek', '_hQuadAvg', '_hGradeAvg', '_hGradeSvcAvg',
  '_hGradeMini', '_hScopeSvcAvg', '_homeViewUser', '_cohorted', 'HOME_PATHS', '_lkBoss', '_lkHomeFlows', '_attnLoad', '_attnCounts', '_ikModuleOn', ...NAV_FNS];
let flowsHost: any = { innerHTML: '' };
const homeEnv = (role: string) => baseEnv(role, {
  API: { get: async (p: string) => REPLIES[p], batch: async () => {}, fresh: async () => null },
  Cache: { get: () => null, getStale: () => null },
  BUS: { view: { vehicles: [], riders: [], pendingNewPeople: 0 }, failed: false },
  LINK: { statusAt: Date.now(), flowsAt: Date.now(), status: null },
  _homeGrade: () => null, _juniorMin: () => 7, _gradeWord: () => 'Grade', gradeBands: () => ({ junior: [7, 8, 9], senior: [10, 11, 12] }), _gradeList: () => [7, 8, 9, 10, 11, 12], _hasAttended: () => true, _lkSvcDay: () => '2026-10-23', _serviceDow: () => 5,
  getMyLeaderId: () => 'l1', renderHomeFollowup: async () => {}, _attnLoad: () => {}, _attn: null, _attnBusy: null, userGrades: (u: any) => [u.grade], _cohortModel: () => 'grades-quads',
  _genderHidden: () => false, SIMPLE_QUAD_LABELS: {}, helpTip: () => '', _lkHomeFlowsHtml: () => '<div id="home-flows-card"></div>', _lkOfflineHtml: () => '',
  _structure: () => ({}), document: { getElementById: (id: string) => (id === 'home-flows' ? flowsHost : null) },
});
async function homeFor(role: string) {
  flowsHost = { innerHTML: '' };
  CAPTURE.out = '';
  await runIn(HOME_FNS, homeEnv(role), role === 'leader' ? 'await renderLeaderHome();' : 'await _renderHomeInner(false);');
  const body = CAPTURE.out;
  // The Home flows card (what _lkHomeFlows draws into #home-flows).
  await runIn(HOME_FNS, homeEnv(role), 'await _lkHomeFlows();');
  // Needs attention: the slot, the lines a worst-case reply makes (their onclick targets), and the routes this login reads for it.
  const paths: string[] = [];
  const env: any = homeEnv(role);
  env.API = { ...env.API, fresh: async (p: string) => { paths.push(p.replace(/=.*/, '=')); return null; } };
  const attn = await runIn(HOME_FNS, env, `await _attnLoad(true);
    const a = { role: S.user.role, errors: 1, unsent: 1, unclear: 1, waiting: 1, offlineAt: 'x', dnc: true, fix: ['a'], needsYou: 1 };
    return { slot: _attnSlot(S.user.role), lines: _attnLines(a).map((l) => l[1]) };`);
  const boss = role === 'admin' || role === 'director';
  return { body: keys(body), flows: keys(flowsHost.innerHTML), attn: boss ? { slot: !!attn.slot, lines: attn.lines, reads: paths } : null };
}

// ---------- BL1c: Bus page tabs, consent chips ----------
const BUS_FNS = ['renderBus', '_busOn', '_busPickTab', '_modOn'];
async function busFor(role: string, canCoordinate: boolean) {
  const BUS = { view: { run: { undoUntil: null, readOnly: false, serviceDate: '2026-10-23', lastChangeBy: null }, canCoordinate, google: { state: 'on' } }, tab: 'roster' };
  CAPTURE.out = '';
  await runIn(BUS_FNS, baseEnv(role, { BUS, _busStartPoll: () => {}, _busHeadDate: () => '2026-10-23', fmtDay: () => 'd', _busTripDate: () => '2026-10-23' }), 'await renderBus();');
  return keys(CAPTURE.out);
}
const CHIP_FNS = ['_busConsentChip', '_busPickupChip', '_busConsentHintHtml', '_busChipRow', '_modOn'];
async function chipKeys() {
  const rows: Record<string, any> = {
    current_parent: { id: 'r1', consent: { year: 2026, current: true, pickup: 'parent' } },
    current_named: { id: 'r1', consent: { year: 2026, current: true, pickup: 'named' } },
    current_dropHome: { id: 'r1', consent: { year: 2026, current: true, pickup: 'dropHome' } },
    not_current: { id: 'r1', consent: { year: 2026, current: false } },
    differs: { id: 'r1', consent: { year: 2026, current: true, differs: true, details: { formId: 'f1' } } },
    none: { id: 'r1', consent: null },
  };
  const attrs = (h: string) => [...h.matchAll(/class="([^"]+)"|on(?:click|change)="(?:event\.stopPropagation\(\);)?([A-Za-z_.]+)/g)].map((m) => m[1] ? `.${m[1]}` : `${m[2]}()`);
  const out: Record<string, any> = {};
  for (const [k, r] of Object.entries(rows)) {
    const h = await runIn(CHIP_FNS, baseEnv('admin'), `return { tap: _busChipRow(${JSON.stringify(r)}, true, true), plain: _busChipRow(${JSON.stringify(r)}, false, false) };`);
    out[k] = { tap: attrs(h.tap), plain: attrs(h.plain) };
  }
  return out;
}

// ---------- BL1d: Youth Setup cards, Admin tabs, error-log groups ----------
// A top-level `const NAME = [...];` array of index.html, evaluated.
const constOf = (name: string) => { const a = HTML.indexOf('\nconst ' + name + ' = ') + name.length + 10; return new Function('return ' + HTML.slice(a, HTML.indexOf('];', a) + 1))(); };
const SETUP_FNS = ['_youthSetupBody', '_setupCard', '_setupElvantoModulesHtml', '_setupFlowHiddenHtml', '_setupIntakeHtml', '_setupModuleMode', '_nyModeOf', '_setupElvCardHtml', '_loginStyleOf', '_setupNoticesHtml', '_modOn'];
async function youthSetupKeys() {
  const cfg = MINISTRY_CONFIG();
  const env = baseEnv('admin', {
    _setupDraft: cfg, _ensureSetupDraft: () => {}, _setupOpen: {}, _setupFlowSteps: [{ flowId: 'f1', flowName: 'F', stepId: 's1', stepName: 'S' }], MINISTRY_CONFIG_DEFAULTS_CLIENT: MinistryConfigSchema.parse({}),
    MINISTRY_PRESETS_INFO: [{ id: 'large-graded-au', title: 'a' }], _SETUP_ELVANTO: constOf('_SETUP_ELVANTO'), _SETUP_SWITCHES: constOf('_SETUP_SWITCHES'), _DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    _logoModeOverride: null, _setupElv: null, helpTip: () => '', userGrades: () => [],
  });
  // B1: live has logins besides Admin, so the Start-from card and the layout button are not drawn.
  return keys(await runIn(SETUP_FNS, env, "return _youthSetupBody(S.settings, [{ role: 'admin' }, { role: 'quad' }]);"));
}
const EL_FNS = ['_elBodyHtml', '_elVisible', '_elIsNew', '_elRowHtml'];
async function errorLogKeys() {
  const rows = ['now', 'later', 'fyi'].map((tier) => ({ id: tier, tier, line1: 'x', line2: 'y', count: 1, lastSeen: new Date(0).toISOString(), ignored: false }));
  const env = baseEnv('admin', { EL_GROUPS: constOf('EL_GROUPS'), _laRelTime: () => '', fmtDay: () => '' });
  return keys(await runIn(EL_FNS, env, `return _elBodyHtml(${JSON.stringify(rows)}, false, 0, '', true);`));
}

// ---------- assembly ----------
const tierOf = (m: Record<string, any>) => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k][0]]));
async function compute() {
  const BL1: any = { roles: {}, shared: {} };
  for (const r of ROLES) {
    BL1.roles[r] = { nav: navFor(r), home: await homeFor(r), bus: await busFor(r, false) };
  }
  BL1.roles.admin.adminTabs = constOf('ADMIN_TABS').map(([id, label]: string[]) => ({ id, label }));
  BL1.roles.admin.youthSetup = await youthSetupKeys();
  BL1.roles['leader (bus coordinator)'] = { bus: await busFor('leader', true) };
  BL1.shared.busConsentChips = await chipKeys();
  BL1.shared.errorLog = {
    groups: await errorLogKeys(), categories: [...ERROR_CATEGORIES], tiers: [...ERROR_TIERS], serverCodes: tierOf(TEXT), clientCodes: tierOf(CLIENT),
  };
  const { services } = await buildContainer();
  const BL2 = buildRoutes(services).map((r) => `${r.method} ${r.path}`).sort();
  const BL3 = MINISTRY_CONFIG().modules;
  return JSON.parse(JSON.stringify({ BL1, BL2, BL3 })); // plain JSON, as the golden file stores it
}

const update = process.env.UPDATE_BASELINE === '1';
if (update && process.env.CI) throw new Error('UPDATE_BASELINE=1 must not be set in CI: the golden is regenerated by a reviewed change only');
const golden = () => JSON.parse(readFileSync(GOLDEN, 'utf8'));
describe('modular-setup baseline (live all-on)', () => {
  let now: any;
  beforeAll(async () => {
    now = await compute();
    if (update) writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  });
  it('the harness really rendered the admin nav', () => expect(now.BL1.roles.admin.nav.navItems.length).toBeGreaterThan(0));
  it('BL1 nav, in-page blocks, Admin tabs, error-log groups per role', () => expect(now.BL1).toEqual(golden().BL1));
  it('BL2 route table', () => expect(now.BL2).toEqual(golden().BL2));
  it('BL3 modules parsed from the live states', () => {
    expect(now.BL3).toEqual(golden().BL3);
    expect(now.BL3).toMatchObject(LIVE_MODULES); // the parse changes no live value
  });
});
