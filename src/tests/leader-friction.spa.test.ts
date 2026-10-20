// Y5 (multisite SPEC #5, part 1): leader friction. Change password for every role (More menu), a shared-login warning
// on both password screens, a half-typed lifegroup report kept across a sign-out (ysc.lkDraft.<login id>), plain
// "Elvanto" wording instead of "console" on the leader pages, and a next step on two dead ends.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const WARN = 'Everyone using this login is signed out. They need the new password.';

// A Map-backed localStorage; broken = every call throws (private mode, blocked storage).
function store(broken = false) {
  const m = new Map<string, string>();
  const f = (fn: any) => (...a: any[]) => { if (broken) throw new Error('blocked'); return fn(...a); };
  return { m, ls: {
    getItem: f((k: string) => (m.has(k) ? m.get(k)! : null)), setItem: f((k: string, v: string) => { m.set(k, String(v)); }),
    removeItem: f((k: string) => { m.delete(k); }), key: f((i: number) => [...m.keys()][i] ?? null), get length() { if (broken) throw new Error('blocked'); return m.size; },
  } };
}

const DRAFT_FNS = ['_lkFresh', '_lkKey', '_lkBoot', '_lkClear', '_lkSoftReset', '_lkDraftKey', '_lkDraftGet', '_lkDraftDrop', '_lkOpenGroup',
  '_lkFormOpen', '_lkRfTick', '_lkRfBack', '_lkReportSend', '_lkAddDays'];
function draftEnv(broken = false) {
  const { m, ls } = store(broken);
  const t: any = { pushed: [], paints: 0, ask: true, back: 0 };
  const G = { groupId: 'g1', defaultDate: '2026-10-19', members: [{ personId: 'p1' }, { personId: 'p2' }] };
  const fns = new Function('__t', 'localStorage', '__G', `
    const S = { user: { id: 'u1', role: 'grade' }, page: 'link-groups' };
    const navPush = () => {}; const _lkPaintGroups = () => { __t.paints++; }; const _lkGroup = () => (LINK.gid === __G.groupId ? __G : null);
    const _lkReports = () => []; const getMyLeaderId = () => 'L1'; const _lkReportOn = () => false; const _lkIamPick = () => {};
    const _lkPush = (it) => { __t.pushed.push(it); }; const _lkUuid = () => 'id-1'; const _lkQGet = () => []; const _lkSchedule = () => {};
    const _lkAdmFresh = () => ({}); const _lkAsk = async () => __t.ask; const _lkGroupsBack = () => { __t.back++; };
    ${DRAFT_FNS.map((n) => extractFn(HTML, n)).join('\n')}
    let LINK = _lkFresh();
    return { ${DRAFT_FNS.join(', ')}, S, get LINK() { return LINK; }, set LINK(v) { LINK = v; } };`)(t, ls, G);
  return { fns, t, m };
}
// A half-typed report on g1: one tick, a note, today 2026-10-20.
function typed(e: ReturnType<typeof draftEnv>) {
  const f = e.fns;
  f._lkBoot();
  f.LINK.today = '2026-10-20';
  f._lkOpenGroup('g1');
  f._lkFormOpen('submit', '2026-10-19');
  f._lkRfTick('p1');
  f.LINK.rf.note = 'Good night';
}

describe('Y5 half-typed lifegroup report survives a sign-out', () => {
  it('_lkSoftReset keeps the draft under ysc.lkDraft.<login id>; the next open of that group restores it', () => {
    const e = draftEnv();
    typed(e);
    e.fns._lkSoftReset(); // e.g. the session expired: S.user is already gone when this runs
    expect(e.fns.LINK.rf).toBeNull();
    const kept = JSON.parse(e.m.get('ysc.lkDraft.u1')!);
    expect(kept.gid).toBe('g1');
    expect(kept.rf).toMatchObject({ mode: 'submit', date: '2026-10-19', ticks: { p1: true }, note: 'Good night', svc: 'none' });
    // Signed in again: another group does not pick it up; that group does.
    e.fns._lkBoot();
    e.fns._lkOpenGroup('g2');
    expect(e.fns.LINK.rf).toBeNull();
    e.fns._lkOpenGroup('g1');
    expect(e.fns.LINK.rf).toMatchObject({ mode: 'submit', date: '2026-10-19', ticks: { p1: true }, note: 'Good night', err: '' });
  });
  it('a form nobody typed in is not kept; another login never sees the draft', () => {
    const e = draftEnv();
    e.fns._lkBoot();
    e.fns._lkOpenGroup('g1');
    e.fns._lkFormOpen('submit', '2026-10-19');
    e.fns._lkSoftReset();
    expect(e.m.has('ysc.lkDraft.u1')).toBe(false);
    const e2 = draftEnv();
    typed(e2);
    e2.fns._lkSoftReset();
    e2.fns.S.user = { id: 'u2', role: 'grade' };
    e2.fns._lkBoot();
    e2.fns._lkOpenGroup('g1');
    expect(e2.fns.LINK.rf).toBeNull();
  });
  it('the new report still starts on No service (operator ruling)', () => {
    const e = draftEnv();
    e.fns._lkBoot();
    e.fns._lkOpenGroup('g1');
    e.fns._lkFormOpen('submit', '2026-10-19');
    expect(e.fns.LINK.rf.svc).toBe('none');
  });
  it('cleared on send', () => {
    const e = draftEnv();
    typed(e);
    e.fns._lkSoftReset();
    e.fns._lkBoot();
    e.fns.LINK.today = '2026-10-20';
    e.fns._lkOpenGroup('g1');
    e.fns._lkReportSend();
    expect(e.t.pushed).toHaveLength(1);
    expect(e.t.pushed[0].payload).toMatchObject({ groupId: 'g1', date: '2026-10-19', attendees: ['p1'], serviceTimeId: null });
    expect(e.m.has('ysc.lkDraft.u1')).toBe(false);
    e.fns._lkSoftReset();
    expect(e.m.has('ysc.lkDraft.u1')).toBe(false);
  });
  it('cleared on Discard report', async () => {
    const e = draftEnv();
    typed(e);
    e.fns._lkSoftReset();
    e.fns._lkBoot();
    e.fns._lkOpenGroup('g1');
    await e.fns._lkRfBack();
    expect(e.m.has('ysc.lkDraft.u1')).toBe(false);
  });
  it('cleared on logout (_lkClear, called by doLogout with the queue key)', () => {
    const e = draftEnv();
    typed(e);
    e.m.set('ysc.lkq.u1', '[]');
    e.fns._lkClear('ysc.lkq.u1');
    expect(e.m.has('ysc.lkDraft.u1')).toBe(false);
    expect(e.m.has('ysc.lkq.u1')).toBe(false);
    // a draft kept earlier by an expiry is cleared too
    const e2 = draftEnv();
    typed(e2);
    e2.fns._lkSoftReset();
    expect(e2.m.has('ysc.lkDraft.u1')).toBe(true);
    e2.fns._lkClear('ysc.lkq.u1');
    expect(e2.m.has('ysc.lkDraft.u1')).toBe(false);
    expect(extractFn(HTML, 'doLogout')).toContain('_lkClear(lkK)');
  });
  it('a localStorage that throws never breaks _lkSoftReset, open, send or logout', async () => {
    const e = draftEnv(true);
    typed(e);
    expect(() => e.fns._lkSoftReset()).not.toThrow();
    expect(e.fns.LINK.rf).toBeNull();
    e.fns._lkBoot();
    e.fns.LINK.today = '2026-10-20';
    expect(() => e.fns._lkOpenGroup('g1')).not.toThrow();
    e.fns._lkFormOpen('submit', '2026-10-19');
    e.fns._lkRfTick('p1');
    expect(() => e.fns._lkReportSend()).not.toThrow();
    expect(e.t.pushed).toHaveLength(1);
    expect(() => e.fns._lkClear('ysc.lkq.u1')).not.toThrow();
  });
  it('a broken stored value is ignored', () => {
    const e = draftEnv();
    e.m.set('ysc.lkDraft.u1', '{not json');
    e.fns._lkBoot();
    expect(() => e.fns._lkOpenGroup('g1')).not.toThrow();
    expect(e.fns.LINK.rf).toBeNull();
  });
});

// The More sheet and the two password screens.
function pwEnv(role: string) {
  let shown = '';
  const app: any = { innerHTML: '' };
  const fns = new Function('__set', '__app', `
    const S = { user: { id: 'u1', role: ${JSON.stringify(role)}, email: 'team@example.com' }, page: 'home' };
    const modal = (h) => __set(h); const closeModal = () => {}; const icN = (k) => '<i ' + k + '>'; const esc = (s) => String(s);
    const moreItems = () => [{ id: 'prayers', ic: 'pray', label: 'Prayers', open: "go('prayers')" }, { id: 'bus', ic: 'bus', label: 'Bus', open: "go('bus')" }];
    const brandMark = () => ''; const Cache = { clear() {} }; const _positionNprog = () => {}; let _shellReady = true;
    const document = { getElementById: (id) => (id === 'app' ? __app : { addEventListener() {} }) };
    ${['_sharedPwWarn', 'openMore', 'showChangeOwnPassword', 'renderMustChangePassword'].map((n) => extractFn(HTML, n)).join('\n')}
    return { openMore, showChangeOwnPassword, renderMustChangePassword };`)((h: string) => { shown = h; }, app);
  return { fns, shown: () => shown, app };
}

describe('Y5 Change password for every role', () => {
  it('a junior leader has Change password in the More menu, and it opens the change form', () => {
    const e = pwEnv('leader');
    e.fns.openMore();
    expect(e.shown()).toContain('closeModal();showChangeOwnPassword()');
    expect(e.shown()).toContain('<span>Change password</span>');
    expect(e.shown().indexOf('Bus')).toBeLessThan(e.shown().indexOf('Change password'));
    e.fns.showChangeOwnPassword();
    expect(e.shown()).toContain('Change Your Password');
    expect(e.shown()).toContain('id="cpw-new"');
  });
  it('every role gets the row', () => {
    for (const r of ['admin', 'director', 'quad', 'grade', 'leader']) {
      const e = pwEnv(r);
      e.fns.openMore();
      expect(e.shown(), r).toContain('showChangeOwnPassword()');
    }
  });
  it('the shared-login warning shows on a shared (grade or quad) login only, on both password screens', () => {
    for (const [r, shared] of [['grade', true], ['quad', true], ['leader', false], ['admin', false], ['director', false]] as const) {
      const e = pwEnv(r);
      e.fns.showChangeOwnPassword();
      expect(e.shown().includes(WARN), r).toBe(shared);
      e.fns.renderMustChangePassword();
      expect(e.app.innerHTML.includes(WARN), r).toBe(shared);
    }
  });
});

describe('Y5 leader wording', () => {
  const statusFns = () => new Function(`
    let LINK = { status: null }; const LK_OFFLINE_MS = 9e5; const S = { user: { role: 'grade' } };
    const _lkSeen = (x) => x; const _lkTime = (x) => x; const _lkOutsideWindow = () => false; const icS = () => ''; const esc = (s) => s;
    ${['_lkStatusText', '_lkStatusHtml'].map((n) => extractFn(HTML, n)).join('\n')}
    return { _lkStatusText, _lkStatusHtml };`)();
  it('"Waiting for the console" and "Console last seen" become "Waiting for Elvanto" and "Elvanto last reached"', () => {
    const f = statusFns();
    expect(f._lkStatusText({ status: 'pending', reason: null })).toBe('Waiting for Elvanto.');
    expect(f._lkStatusText({ status: 'pending', reason: null }, '7:02 pm')).toBe('Waiting for Elvanto. Elvanto last reached 7:02 pm');
    expect(f._lkStatusHtml({ status: 'pending', reason: null }, '7:02 pm')).toBe('Waiting for Elvanto. Elvanto last reached 7:02 pm');
  });
  it('the dead ends say the next step', () => {
    expect(extractFn(HTML, '_lkIamListHtml')).toContain("'No leaders found. Ask your admin to add leaders.'");
    expect(extractFn(HTML, '_lkGroupsHtml')).toContain('No lifegroups for this login. Ask your admin.');
  });
  // The leader pages' render functions (Home, Health, My Connections, Prayers, Birthdays, Bus, New person, Setup,
  // Check-in, Lifegroup report, Flow steps, the "I am" picker, the password screens, the More menu). No string literal in
  // them says "console". _lkStatusText and _lkBanner are checked by what they show a leader (above and below): their
  // admin-only lines may name the console.
  const LEADER_FNS = ['renderLeaderHome', 'renderHome', 'renderMyStudents', 'renderAtRisk', 'renderPrayers', 'renderUpcomingBirthdays',
    'renderBus', 'renderNewYouth', 'renderConnect', 'renderConnectView', 'renderLink', 'renderLinkCheckin', 'renderLinkGroups', 'renderLinkFlows',
    '_lkListHtml', '_lkDoneRowsHtml', '_lkRowHtml', '_lkPickHtml', '_lkLeadersHtml', '_lkIamListHtml', '_lkGroupsHtml', '_lkReportHtml',
    '_lkWeekBodyHtml', '_lkGroupHtml', '_lkFormHtml', '_lkMembersHtml', '_lkFfHtml', '_lkTilesHtml', '_lkFlowRowHtml', '_lkFlowsHtml',
    '_lkHomeFlowsHtml', '_lkStepHtml', '_lkRemoveHtml', '_lkOfflineHtml', '_lkStatusHtml', 'showChangeOwnPassword',
    'renderMustChangePassword', 'openMore', 'moreItems'];
  it('rule: no leader-page string contains "console"', () => {
    for (const n of LEADER_FNS) {
      const body = extractFn(HTML, n).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const lits = body.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`/g) || [];
      expect(lits.filter((l) => /console/i.test(l)), n).toEqual([]);
    }
  });
  it('rule: the link banner a leader sees never says "console"', () => {
    const banner = (role: string) => new Function('role', `
      const S = { user: { role } }; const LINK = { status: null }; const icS = () => ''; const esc = (s) => s; const _lkSeen = (x) => x;
      ${['_lkBanner', '_lkBoss', '_lkOfflineSince'].map((n) => extractFn(HTML, n)).join('\n')}
      const LK_OFFLINE_MS = 9e5;
      return _lkBanner;`)(role);
    for (const r of ['grade', 'quad', 'leader']) {
      const st = { console: { online: false, lastSeenAt: '2026-10-20T01:00:00.000Z', consoles: 2 } };
      expect(banner(r)(['checkIn'], st), r).not.toMatch(/console/i);
      expect(banner(r)(['submitReport'], st), r).not.toMatch(/console/i);
    }
  });
});
