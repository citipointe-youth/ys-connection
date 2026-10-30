// Y6b (multisite SPEC Y6): Home "Needs attention" for admin and oversight, the Admin tab badges, and the intake page's
// two new console branches ("No console connected yet." and "The console isn't set up for intake yet."). Extract-and-run:
// the REAL functions from public/index.html run against stubbed route payloads. No server.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIndexHtml, loadFns, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const ADMIN_TABS = [/^const ADMIN_TABS = .*$/m, /^const ADMIN_TAB_HOME = .*$/m].map((re) => HTML.match(re)![0]).join(';');
// 2026-10-20 20:00 in Brisbane (UTC+10); the console was last seen at 7:40 pm.
const NOW = Date.parse('2026-10-20T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const ATTN = ['_modOn', '_attnCounts', '_attnLines', '_attnHtml', '_attnBadges', '_attnMine', '_attnSlot', '_attnLoad', '_adminTabsHtml',
  '_lkSeen', '_lkTime', '_lkAt', 'fmtDay', 'esc'];

// The routes, as each one answers today. A healthy Brisbane: every count zero, the console online.
function healthy(): Record<string, any> {
  return {
    '/admin/errors': { rows: [{ id: 'e1', tier: 'later' }, { id: 'e2', tier: 'fyi' }, { id: 'e3', tier: 'now', ignored: true }] },
    '/admin/unsent': { rows: [] },
    '/setup/status': { needsAdmin: false, checks: [{ id: 'database', label: 'Database connection', state: 'ok' },
      { id: 'google', label: 'Google', state: 'optional' }, { id: 'peopleFlow', label: 'New People flow: New People 2026', state: 'ok' }] },
    '/link/actions?serviceDate=2026-10-20': [{ id: 'a1', type: 'checkIn', status: 'sent', createdAt: ago(3 * 36e5) }],
    '/link/actions?status=unclear': [],
    '/link/status': { console: { online: true, lastSeenAt: ago(30_000), capabilities: { checkIn: 'live' } }, consoleLinkRev: 13, appLinkRev: 13 },
    '/link/intake?mode=intake': { consoleLinkRev: 13, dates: [{ date: '2026-10-16', counts: { needsYou: 0, ready: 2, done: 5 } }] },
  };
}
function broken(): Record<string, any> {
  const r = healthy();
  r['/admin/errors'].rows.push({ id: 'n1', tier: 'now' }, { id: 'n2', tier: 'now' }, { id: 'n3', tier: 'now' });
  r['/admin/unsent'].rows.push({ id: 'u1' }, { id: 'u2' });
  r['/setup/status'].checks.push({ id: 'appOrigin', label: 'APP_ORIGIN', state: 'fix', fix: 'x' });
  r['/setup/status'].checks[2] = { id: 'peopleFlow', label: 'New People flow', state: 'fix', fix: 'y' };
  r['/link/actions?serviceDate=2026-10-20'].push(
    { id: 'f1', type: 'firstTimerCheckIn', status: 'pending', createdAt: ago(2 * 36e5) },
    { id: 'f2', type: 'firstTimerCheckIn', status: 'claimed', createdAt: ago(90 * 60_000) },
    { id: 'f3', type: 'firstTimerCheckIn', status: 'pending', createdAt: ago(10 * 60_000) }, // under an hour: not yet
    { id: 'f4', type: 'firstTimerCheckIn', status: 'sent', createdAt: ago(5 * 36e5) });
  r['/link/actions?status=unclear'] = [{ id: 'x1', status: 'unclear' }];
  r['/link/status'] = { console: { online: false, lastSeenAt: ago(20 * 60_000), capabilities: { checkIn: 'live' } }, consoleLinkRev: 13, appLinkRev: 13 };
  r['/link/intake?mode=intake'].dates.push({ date: '2026-10-09', counts: { needsYou: 2, ready: 0, done: 1 } });
  return r;
}

// loadFns builds `new Function(prelude + body + return {...})`; the stubs read these globals.
function run(role: string, routes: Record<string, any>, modules: Record<string, string> = { intakeAdmin: 'on', checkin: 'on' }) {
  const g = globalThis as any;
  const calls: string[] = [];
  g.__attnT = { role, routes, modules, calls };
  const f = loadFns(ATTN, `
    const __t = globalThis.__attnT;
    var S = { user: { id: 'u-' + __t.role, role: __t.role }, settings: { ministryConfig: { structure: { timeZone: 'Australia/Brisbane' }, modules: __t.modules } } };
    let _attn = null, _attnBusy = null;
    ${ADMIN_TABS}
    const API = { fresh: async (p) => { __t.calls.push(p); if (!(p in __t.routes)) throw new Error('no route ' + p); return __t.routes[p]; } };
    const _linkOn = () => __t.modules.checkin === 'on';
    const _ikModuleOn = () => S.user.role === 'admin' && __t.modules.intakeAdmin === 'on';
    const _attnPaint = () => {};
    const icS = () => '';
  `, [...ATTN, 'S', 'get attn() { return _attn; }']);
  return { f, calls };
}
const texts = (f: any) => f._attnLines(f.attn).map((l: [string, string]) => l[0]);
const strip = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

afterEach(() => { vi.useRealTimers(); });
function at() { vi.useFakeTimers(); vi.setSystemTime(NOW); }

describe('Y6b Home "Needs attention"', () => {
  it('the admin sees every line, in plain words that point to a real place', async () => {
    at();
    const { f } = run('admin', broken());
    await f._attnLoad(true);
    expect(texts(f)).toEqual([
      '3 problems in the error log.',
      "2 new people weren't sent.",
      '1 unclear save. See Admin > Elvanto link.', // 2026-10-22 B3: the link page explains Check again
      '2 first-timers have waited over 1 hour for Elvanto. See Admin > Elvanto link.',
      'The console is offline since 7:40 pm.',
      'System check: 2 things need fixing.', // 2026-10-22 B3: one line, the detail is on the page
      '2 families need you in More > New youth & consent.',
    ]);
    const h = f._attnHtml(f.attn);
    expect(strip(h)).toContain('Needs attention');
    expect(h).toContain("switchAdminTab('errors')");
    expect(h).toContain("switchAdminTab('unsent')");
    expect(h).toContain("switchAdminTab('system')");
    expect(h).toContain("go('link-admin')");
    expect(h).toContain("go('link-intake')");
  });
  it('singular words for one of each', async () => {
    at();
    const r = broken();
    r['/admin/errors'].rows = [{ id: 'n1', tier: 'now' }];
    r['/admin/unsent'].rows = [{ id: 'u1' }];
    r['/setup/status'].checks.pop(); // one System check fix (New People flow)
    r['/link/actions?status=unclear'] = [{ id: 'x1', status: 'unclear' }, { id: 'x2', status: 'unclear' }];
    r['/link/actions?serviceDate=2026-10-20'] = [{ id: 'f1', type: 'firstTimerCheckIn', status: 'pending', createdAt: ago(2 * 36e5) }];
    r['/link/intake?mode=intake'].dates = [{ date: '2026-10-09', counts: { needsYou: 1 } }];
    const { f } = run('admin', r);
    await f._attnLoad(true);
    const t = texts(f);
    expect(t).toContain('1 problem in the error log.');
    expect(t).toContain("1 new person wasn't sent.");
    expect(t).toContain('2 unclear saves. See Admin > Elvanto link.');
    expect(t).toContain('System check: New People flow needs fixing.'); // one fix keeps its name
    expect(t).toContain('1 first-timer has waited over 1 hour for Elvanto. See Admin > Elvanto link.');
    expect(t).toContain('1 family needs you in More > New youth & consent.');
  });
  it('an oversight never reads /admin/unsent, System check or the error log (no admin:manage); the link lines stay', async () => {
    at();
    const { f, calls } = run('oversight', broken());
    await f._attnLoad(true);
    expect(calls.some((p) => p.startsWith('/admin/') || p.startsWith('/setup/') || p.startsWith('/link/intake'))).toBe(false);
    expect(calls).toContain('/link/status');
    const t = texts(f);
    expect(t).toEqual([
      '1 unclear save. Check it in Elvanto.',
      '2 first-timers have waited over 1 hour for Elvanto.',
      'The console is offline since 7:40 pm.',
    ]);
    // An oversight cannot open Admin > Elvanto link: their lines are not links there.
    expect(f._attnHtml(f.attn)).not.toContain('link-admin');
  });
  it('an oversight with every link screen off reads nothing at all', async () => {
    at();
    const { f, calls } = run('oversight', broken(), { checkin: 'off' });
    await f._attnLoad(true);
    expect(calls).toEqual([]);
    expect(f._attnHtml(f.attn)).toBe('');
  });
  it('a leader, a grade login and a quad see nothing new and read nothing', async () => {
    at();
    for (const role of ['leader', 'grade', 'quad']) {
      const { f, calls } = run(role, broken());
      await f._attnLoad(true);
      expect(calls, role).toEqual([]);
      expect(f._attnSlot(role), role).toBe('');
    }
    expect(extractFn(HTML, 'renderLeaderHome')).not.toContain('attn');
  });
  it('clean: the card is hidden (Brisbane when healthy)', async () => {
    at();
    const { f } = run('admin', healthy());
    await f._attnLoad(true);
    expect(texts(f)).toEqual([]);
    expect(f._attnHtml(f.attn)).toBe('');
    expect(f._attnSlot('admin')).toBe('<div id="home-attn"></div>');
    // Never seen a console (no link in use): not "offline".
    const r = healthy();
    r['/link/status'] = { console: { online: false, lastSeenAt: null, capabilities: null }, consoleLinkRev: null, appLinkRev: 13 };
    const g = run('admin', r).f;
    await g._attnLoad(true);
    expect(texts(g)).toEqual([]);
  });
  it('a route that fails drops only its own line', async () => {
    at();
    const r = broken();
    delete r['/admin/errors'];
    delete r['/link/status'];
    const { f } = run('admin', r);
    await f._attnLoad(true);
    const t = texts(f);
    expect(t.some((x: string) => /error log|offline/.test(x))).toBe(false);
    expect(t).toContain("2 new people weren't sent.");
  });
  it('a second call while a read is in flight waits for it instead of reading again', async () => {
    at();
    const { f, calls } = run('admin', broken());
    await Promise.all([f._attnLoad(true), f._attnLoad(true), f._attnLoad()]);
    expect(calls.length).toBe(7);
    expect(texts(f)).toContain('3 problems in the error log.');
    await f._attnLoad(true); // finished: the next forced load reads again
    expect(calls.length).toBe(14);
  });
  it('one reload a minute; a forced load always reads', async () => {
    at();
    const { f, calls } = run('admin', healthy());
    await f._attnLoad(true);
    const n = calls.length;
    await f._attnLoad();
    expect(calls.length).toBe(n);
    vi.setSystemTime(NOW + 61_000);
    await f._attnLoad();
    expect(calls.length).toBe(2 * n);
  });
  it('another login never sees the last login\'s counts', async () => {
    at();
    const { f } = run('admin', broken());
    await f._attnLoad(true);
    expect(f._attnSlot('admin')).toContain('Needs attention');
    f.S.user = { id: 'someone-else', role: 'admin' };
    expect(f._attnSlot('admin')).toBe('<div id="home-attn"></div>');
    expect(f._adminTabsHtml('import')).not.toContain('pill warn');
  });
  it('Home draws the slot for admin and oversight and loads it after the paint', () => {
    const src = extractFn(HTML, '_renderHomeInner');
    expect(src).toContain('_attnSlot(qu.role)');
    expect(src).toContain('_attnLoad()');
  });
});

describe('Y6b Admin tab badges use the same counts', () => {
  it('Problems (errors + unsent + System check fixes) and Elvanto link carry the card counts', async () => {
    at();
    const { f } = run('admin', broken());
    await f._attnLoad(true);
    expect(f._attnBadges(f.attn)).toEqual({ problems: 7, link: 3 }); // 2026-10-22 B1: one Problems badge
    const h = f._adminTabsHtml('import');
    expect(h).toContain(`switchAdminTab('problems')">Problems <span class="pill warn">7</span>`);
    expect(h).toContain(`switchAdminTab('link')">Elvanto link <span class="pill warn">3</span>`);
    expect(h).toContain(`<button class="tbbtn " onclick="switchAdminTab('accounts')">Accounts</button>`);
  });
  it('healthy: no badge anywhere, the tab list is unchanged', async () => {
    at();
    const { f } = run('admin', healthy());
    await f._attnLoad(true);
    expect(f._adminTabsHtml('errors')).not.toContain('pill');
    expect(f._adminTabsHtml('errors')).not.toMatch(/\(\d+\)/);
  });
  it('the admin pages load the counts too', () => {
    expect(extractFn(HTML, 'renderAdminView')).toContain('_attnLoad()');
    expect(extractFn(HTML, 'renderLinkAdmin')).toContain('_attnLoad()');
  });
});

// The intake page's console branches (index.html _ikOldConsole / _ikPageHtml).
const IK = ['_ikModuleOn', '_ikRev', '_intakeOn', '_ikOldConsole', '_ikSaveBlock', '_ikTextBlock', '_ikPageHtml'];
function ik(st: any, intakeAdmin = 'on') {
  return loadFns(IK, `
    var S = { user: { id: 'a', role: 'admin' }, settings: { ministryConfig: { modules: { intakeAdmin: ${JSON.stringify(intakeAdmin)} } } } };
    const I = { dates: [{ date: '2026-10-09' }], key: null, resend: {}, debT: null };
    const _ik = () => I, _ikSt = () => (${JSON.stringify(st)});
    const esc = (s) => String(s), icS = () => '', progBar = () => 'loading';
    const _hubPage = () => 'LIST', _ikFamilyPage = () => 'FAMILY', _ikHoldReason = () => '', _ikOpenOf = () => null, _ikTodo = () => [1];
  `);
}
const INTAKE_CAPS = { intakeAnswer: 'live', intakeSave: 'live', consentSave: 'live', intakeText: 'live', consentLookup: 'live', checkIn: 'live' };
const ST = (rev: number | null, caps: any = INTAKE_CAPS) => ({ console: { online: true, lastSeenAt: ago(1000), capabilities: caps }, consoleLinkRev: rev, appLinkRev: 13 });
const DET = { row: { key: 'k', status: 'ready' }, detail: { steps: [] }, actions: [] };
const LIST = { takenAt: ago(60_000), stale: false };

describe('Y6b "Console out of date" branches on the intake page', () => {
  it('consoleLinkRev null: "No console connected yet."', () => {
    const f = ik(ST(null, null));
    expect(f._intakeOn(ST(null, null))).toBe(false);
    expect(f._ikPageHtml()).toContain('No console connected yet.');
    expect(f._ikPageHtml()).not.toContain('Try again');
    expect(f._ikSaveBlock(DET, LIST, ST(null, null))).toBe('No console connected yet.');
    expect(f._ikTextBlock(DET, LIST, ST(null, null))).toBe('No console connected yet.');
  });
  it('a console whose claim leaves out the intake types (C2: names blank): "isn\'t set up for intake yet"', () => {
    const half = { checkIn: 'live', completeStep: 'live', removeFromFlowStep: 'live', submitReport: 'live' };
    const f = ik(ST(13, half));
    const want = "The console isn't set up for intake yet. Set it up on the console, then select Try again.";
    expect(f._intakeOn(ST(13, half))).toBe(false);
    expect(f._ikPageHtml()).toContain(want);
    // Right after the module is switched On the stored capabilities are still the stripped ones: Try again reloads.
    expect(f._ikPageHtml()).toContain('onclick="_hubLoad(false)">Try again</button>');
    expect(f._ikSaveBlock(DET, LIST, ST(13, half))).toBe(want);
    expect(f._ikTextBlock(DET, LIST, ST(13, half))).toBe(want);
  });
  it('only while this app\'s own intake module is on (the app strips the same types when it is off)', () => {
    const half = { checkIn: 'live' };
    const f = ik(ST(13, half), 'off');
    expect(f._ikOldConsole(ST(13, half))).not.toContain('set up for intake');
  });
  it('Brisbane: a rev 13 console with the intake types is on; an old console keeps its line', () => {
    const f = ik(ST(13));
    expect(f._intakeOn(ST(13))).toBe(true);
    expect(f._ikPageHtml()).toBe('LIST');
    expect(f._ikSaveBlock(DET, LIST, ST(13))).toBe('');
    const old = ik(ST(3));
    expect(old._ikPageHtml()).toContain('Console out of date: use New youth on the console PC');
    expect(old._ikPageHtml()).not.toContain('Try again'); // Brisbane's old-console page is unchanged
    expect(old._ikSaveBlock(DET, LIST, ST(3))).toBe('Console out of date: use New youth on the console PC');
    expect(old._ikOldConsole()).toBe('Console out of date: use New youth on the console PC');
  });
});
