// navfix lane n5 (Lifegroups + Flows): S-1/D7 client, B05, B06, B09, B11, B12, B16, B24. Harness copied from fix16-e.spa.test.ts
// (no lane may edit a shared test file). Run from the REAL page source (extract-and-evaluate).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC, withPlain } from './helpers/extract-fn';

const FNS = ['esc', 'progBar', '_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', 'moreItems', 'setMyLeaderId', '_vgSnap', '_vgActive',
  '_lkFresh', '_lkTime', '_lkDay', 'fmtDay', '_lkSvcLabel', '_lkStatusText', '_lkStatusTone', '_lkCap', '_lkCapOff', '_lkLastSeen', '_lkSeen', '_lkOutsideWindow',
  '_lkBanner', '_lkKey', '_lkQGet', '_lkQSet', '_lkUuid', '_lkPush', '_lkSchedule', '_lkTakeBack', '_lkQueuedIdx', '_lkMerge', '_lkApply',
  '_lkBoot', '_lkDrain', '_lkActions', '_lkFlush', '_lkSwitchedOff', '_lkFailed', '_lkRetry', '_lkResults', '_lkPill', '_lkLogoutGuard', '_lkClear', '_lkSoftReset', '_lkOnPage',
  '_lkRefreshView', '_lkTop', '_lkSvc', '_lkFilter', '_lkLists', '_lkListHtml', '_lkDoneRowsHtml', '_lkDoneToggle', '_lkSetSearch', '_lkRowHtml', '_lkCheck', '_lkUndo',
  '_lkLeadersView', '_lkLeaderState', '_lkTickedCount', '_lkLeadersHtml', '_lkLeadersFoot', '_lkLeadersDraw',
  '_lkTickLeader', '_lkTickAll', '_lkLeadersSubmit', '_lkOpenLeaders', '_lkTickStop', '_lkStatusHtml',
  '_lkSwitchGuard', '_lkSwitchLeader', '_lkIamPick', '_lkIamListHtml', '_lkIamFilter', '_lkLoadLeaders', '_lkIamUse', '_lkMyName', '_lkAddDays',
  '_lkLastReportLabel', '_lkAddReport', '_lkCatFilter', '_lkCat', '_lkTint', '_lkWeekStart', '_lkWeeks', '_lkReports', '_lkReportOn', '_lkWeekReports', '_lkWeekReport', '_lkReportDateFor', '_lkReportHtml', '_lkWeekBodyHtml', '_lkWeekGo', '_lkGroup', '_lkGroupAct', '_lkGroupsHtml', '_lkGroupHtml', '_lkNoteCount',
  '_lkFormHtml', '_lkPaintGroups', '_lkOpenGroup', '_lkGroupsBack', '_lkNewReport', '_lkEditReport', '_lkFormOpen',
  '_lkRfDate', '_lkRfDnm', '_lkRfTick', '_lkRfGuests', '_lkRfSvc', '_lkRfNote', '_lkReportSend', '_lkReportUndo', '_lkReportCancel',
  '_lkTapToast', '_lkToastDraw', '_lkToastUndo', '_lkSvcDay', '_lkNotToday', '_lkDayCheck', '_lkNoTonight', '_lkTakeServices', '_lkLoadPeople', '_lkPickService', '_lkPickHtml', '_lkPickFoot',   '_lkToday', '_lkFlowRow', '_lkFlowAct', '_lkFlowGroups', '_lkFirstName', '_lkSmsHref', '_lkTextHref', '_lkMyFlowRows', '_lkFlowDue', '_lkFlowRowHtml', '_lkFlowDrop', '_lkFlowsHtml', '_lkHomeFlowsHtml', '_lkCanComplete', '_lkHubOwned', '_lkReassign', '_lkFits', '_lkPickList', '_lkPicked', '_lkAssignSave', '_lkRevLine', '_busGradeChip', 'fmtPhone', '_drop', 'helpTip', '_lkStepHtml', '_lkOpenStep', '_lkStepDraw', '_lkStepNote', '_lkStepSend',
  '_lkStepUndo', '_lkStepCancel', '_lkPaintFlows', '_lkStepActions', 'lgDisplayName', '_lkWord',
  'renderLink', '_lkTickStart', '_lkStatusLoad', '_lkHomeFlows', '_lkLoadFlows', '_lkAdmFresh', '_lkLastFriday', '_lkAt', '_lkLogWho', '_lkLogRowHtml', '_lkLogFile', '_lkLogAoa',
  '_lkLogExport', '_lkEvents', '_lkVerb', '_lkAdmStatusHtml', '_lkAdmMatchHtml', '_lkAdmLogListHtml', '_lkAdmLogHtml', '_lkAdminHtml',
  '_lkMembersHtml', '_lkMemberRows', '_lkMemOff', '_lkMembersLoad', '_lkYpDraw', '_lkMemQueue', '_lkMemRemove', '_lkMemKeep',
  // run 2026-10-15 lane B: DNC, flow filters, bulk Complete, Remove from step, console offline
  '_lkBoss', '_lkOfflineSince', '_lkOfflineHtml', '_lkFlowTypes', '_lkStepBlock', '_lkPeopleFlowFound', '_lkConsentWait', '_lkNotReceived', '_lkNotReceivedText', '_lkFlowFree', '_lkCanRemove', '_lkFlowVisible', '_lkFlowKind', '_lkFirstStep', '_lkFfGet',
  '_lkFfHtml', '_lkFfToggle', '_lkFlowShown', '_lkFlowBucket', '_lkTickable', '_lkSelIds', '_lkSel', '_lkSelAll', '_lkSelClear', '_lkFlowsDraw',
  '_lkBulkOpen', '_lkBulkSend', '_lkRemoveHtml', '_lkRemoveAsk', '_lkRemoveBack', '_lkRemoveSend', '_lkStepBtns', 'dncChip', 'dncBanner',
  '_structure', 'gradeBands', '_juniorMin', '_ikModuleOn', '_lkYpAdd', '_lkYpSet', '_lkYouthFilter', '_lkLoadGroups', '_lkRfBack'];

const SVC = { serviceTimeId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222',
  name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16' };
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BODY = withPlain(SITE_TIME_SRC + '\n' + FNS.map((n) => extractFn(loadIndexHtml(), n)).join('\n'), FNS);
// APP-49: the real constant, read from the page (a copy here would hide a change).
const LK_DOOR_TYPES_SRC = ['LK_DOOR_TYPES', 'LK_MEM_TYPES', 'LK_GROUP_TYPES', 'LK_FLOW_TYPES', 'LK_FF', 'LK_CATS', 'LK_OFFLINE_MS']
  .map((n) => loadIndexHtml().match(new RegExp(`^const ${n} = .*;`, 'm'))![0]).join('\n');

interface Env { storage: Map<string, string>; failStorage?: boolean; quota?: boolean; post?: (path: string, body: any, ms?: number) => Promise<any>;
  fresh?: (path: string) => Promise<any>;
  role?: string; mode?: string; modules?: Record<string, string>; leaderId?: string | null; }

function makeEnv(e: Partial<Env> = {}) {
  const env: Env = { storage: e.storage ?? new Map(), ...e } as Env;
  const calls = { posts: [] as any[], toasts: [] as string[], modals: [] as string[], closed: 0, asks: [] as string[], apps: [] as string[], gos: [] as string[], els: {} as Record<string, any> };
  const ls = {
    getItem: (k: string) => { if (env.failStorage) throw new Error('blocked'); return env.storage.has(k) ? env.storage.get(k)! : null; },
    setItem: (k: string, v: string) => { if (env.failStorage) throw new Error('blocked'); if (env.quota) throw new Error('QuotaExceededError'); env.storage.set(k, String(v)); },
    key: (i: number) => [...env.storage.keys()][i] ?? null,
    __fresh: (p: string) => (env.fresh ? env.fresh(p) : Promise.reject(new Error('no'))),
    get length() { return env.storage.size; },
    removeItem: (k: string) => { if (env.failStorage) throw new Error('blocked'); env.storage.delete(k); },
  };
  const prelude = `
    const navPush = () => {};
    const navBack = () => { __calls.gos.push('back'); };
    const S = { user: { id: 'u1', role: ${JSON.stringify(env.role ?? 'grade')} }, page: 'home',
      settings: { ministryConfig: { modules: Object.assign({ newYouthForms: ${JSON.stringify(env.mode ?? 'on')} }, ${JSON.stringify(env.modules ?? {})}) } } };
    let LINK = _lkFresh();
    ${LK_DOOR_TYPES_SRC}
    const localStorage = __ls;
    const navigator = { userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' };
    const document = { getElementById: (id) => __calls.els[id] || null, visibilityState: 'visible' };
    const API = { post: (p, b, ms) => __post(p, b, ms), fresh: (p) => __ls.__fresh ? __ls.__fresh(p) : Promise.reject(new Error('no')), get: () => Promise.reject(new Error('no')) };
    const setApp = (h) => __calls.apps.push(h);
    const go = (p) => __calls.gos.push(p);
    const shell = (h) => h;
    const toast = (m) => __calls.toasts.push(m);
    const modal = (h) => __calls.modals.push(h);
    const closeModal = () => { __calls.closed++; };
    const icS = (k) => '<svg data-ic="' + k + '"></svg>';
    const L = (k) => k;
    const _busOn = () => false;
    const _prayersOn = () => true;
    const _deviceId = () => 'dev-1';
    const _deviceLabel = () => 'iPhone · Safari';
    let __leader = ${JSON.stringify(env.leaderId ?? null)};
    const getMyLeaderId = () => __leader;
    const _lkAsk = (t, yes, no) => { __calls.asks.push(t + ' | ' + yes + ' | ' + no); return Promise.resolve(__answers.shift()); };
    function __get() { return { S, LINK }; }
  `;
  const post = env.post ?? (() => Promise.resolve({ results: [] }));
  const answers: any[] = [];
  const fns = new Function('__ls', '__post', '__calls', '__answers',
    `${prelude}\n${BODY}\nreturn { ${[...FNS, '__get'].join(', ')} };`,
  )(ls, (p: string, b: any, ms?: number) => { calls.posts.push({ p, b, ms }); return post(p, b, ms); }, calls, answers);
  return { fns, calls, env, answers, get: () => fns.__get() as { S: any; LINK: any } };
}

const html = loadIndexHtml();
const strip = (h: string) => h.replace(/<[^>]*>/g, '').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

afterEach(() => { vi.useRealTimers(); });

const G = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RSVC = [
  { serviceTimeId: P(50), serviceId: P(51), name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16', isDefault: true },
  { serviceTimeId: P(52), serviceId: P(53), name: 'Tue LG', startsAt: '2026-10-13T08:30:00.000Z', ymd: '2026-10-13', isDefault: true },
];
const grp = (over: any = {}) => ({ groupId: G(1), name: 'Yr 9 Girls', meets: 'Tue 6:30 PM', grade: 9, gender: 'female',
  members: [{ personId: P(61), name: 'Ava Example', leader: false }, { personId: P(62), name: 'Dana Testleader', leader: true },
    { personId: P(63), name: 'Ben Sample', leader: false }],
  thisWeek: 'reported', defaultDate: '2026-10-13', openAction: null,
  lastReport: { reportId: G(9), date: '2026-10-13', time: '18:30', didNotMeet: false, attendees: [P(61), P(62)], guests: 2,
    serviceTimeId: null, editable: true, blocked: null }, history: [], ...over });
const setup = (leaderId: string | null = 'L1', over: any = {}, e: Partial<Env> = {}) => {
  const h = makeEnv({ leaderId, ...e });
  const L = h.get().LINK;
  L.today = '2026-10-16'; L.services = RSVC; L.ldrs = [{ id: 'L1', fullName: 'Cody Codeman', active: true }];
  L.groups = [grp(over)]; L.gid = G(1);
  return h;
};


const REF = { id: '30000000-0000-4000-8000-000000000001', type: 'submitReport', status: 'refused', reason: 'report-exists', resultAt: '2026-10-16T07:00:00Z' };
describe('S-1 / D7 a refusal shows on return (server lastRefused), reason-only chip', () => {
  it('group: no open row, no phone answer -> lastRefused drives the refused line on the list and the group page', () => {
    const h = setup('L1', { openAction: null, lastRefused: REF });
    const g = h.get().LINK.groups[0];
    expect(h.fns._lkGroupAct(g)).toEqual(REF);
    expect(h.fns._lkGroupsHtml()).toContain('lk-st bad');
    expect(h.fns._lkGroupHtml(g)).toContain('lk-st bad');
  });
  it('group: missing lastRefused (older server) -> no line', () => {
    const h = setup('L1', { openAction: null });
    expect(h.fns._lkGroupAct(h.get().LINK.groups[0])).toBeNull();
    expect(h.fns._lkGroupsHtml()).not.toContain('lk-st');
  });
  it('group: an open row or this phone\'s answer wins over lastRefused', () => {
    const open = { id: 'o1', type: 'submitReport', status: 'pending', reason: null };
    const h = setup('L1', { openAction: open, lastRefused: REF });
    const g = h.get().LINK.groups[0];
    expect(h.fns._lkGroupAct(g)).toBe(open);
    h.get().LINK.gres = { [G(1)]: { id: 'x', type: 'submitReport', status: 'cancelled', reason: null } };
    expect(h.fns._lkGroupAct(g).id).toBe('x');
  });
  it('flow: lastRefused shows when the step has no open row; missing -> null', () => {
    const h = setup();
    const ref = { ...REF, type: 'completeStep', reason: 'step-moved' };
    expect(h.fns._lkFlowAct({ rowId: 'r1', openAction: null, lastRefused: ref })).toEqual(ref);
    expect(h.fns._lkFlowAct({ rowId: 'r1', openAction: null })).toBeNull();
    const open = { id: 'o2', type: 'completeStep', status: 'claimed', reason: null };
    expect(h.fns._lkFlowAct({ rowId: 'r1', openAction: open, lastRefused: ref })).toBe(open);
  });
});

describe('B05 an add the console already sent is a member: the button says Remove', () => {
  const mem = (status: string) => {
    const h = setup();
    const L = h.get().LINK;
    L.gmOpen[G(1)] = true;
    L.gm[G(1)] = { canEdit: true, members: [], changes: [{ id: 'c1', type: 'addGroupMember', personId: P(70), name: 'Tom LDummyton', status, reason: null }] };
    return h;
  };
  it('sent add -> "Remove" button and a Remove question', async () => {
    const h = mem('sent');
    const html = h.fns._lkMembersHtml(h.get().LINK.groups[0]);
    expect(html).toMatch(/_lkMemRemove\([^)]*\)">Remove<\/button>/);
    expect(html).not.toContain('>Cancel</button>');
    h.answers.push(false);
    await h.fns._lkMemRemove(G(1), P(70));
    expect(h.calls.asks[0]).toMatch(/^Remove Tom LDummyton from .*[^o]\? \| Remove \| Keep$/); // plain pass: no 'in Elvanto' for a non-boss
  });
  it('pending add -> still "Cancel" / "Stop adding"', async () => {
    const h = mem('pending');
    expect(h.fns._lkMembersHtml(h.get().LINK.groups[0])).toMatch(/_lkMemRemove\([^)]*\)">Cancel<\/button>/);
    h.answers.push(false);
    await h.fns._lkMemRemove(G(1), P(70));
    expect(h.calls.asks[0]).toMatch(/^Stop adding Tom LDummyton/);
  });
});

describe('B06 bulk Complete sheet lists the ticked names', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ rowId: 'r' + i, flowId: 'F1', flowName: 'New People', stepId: 'S2', stepName: 'Call',
    stepOrder: 2, personId: P(80 + i), name: 'Person ' + i + ' <b>', due: null, consent: 'ok', dnc: false, openAction: null }));
  const open = (n: number, tick: number) => {
    const h = setup('L1');
    const L = h.get().LINK;
    L.flows = rows(n); L.fsel = {};
    for (let i = 0; i < tick; i++) L.fsel['r' + i] = true;
    h.fns._lkBulkOpen();
    return h.calls.modals.at(-1) as string;
  };
  it('3 ticks -> the 3 names (escaped), no fold', () => {
    const m = open(4, 3);
    expect(m).toContain('Complete 3 steps');
    for (let i = 0; i < 3; i++) expect(m).toContain('Person ' + i + ' &lt;b&gt;');
    expect(m).not.toContain('Person 3');
    expect(m).not.toContain('<details');
  });
  it('7 ticks -> 5 names shown, the other 2 folded in <details>', () => {
    const m = open(7, 7);
    const fold = m.slice(m.indexOf('<details'));
    expect(m.indexOf('<details')).toBeGreaterThan(m.indexOf('Person 4'));
    expect(fold).toContain('2 more');
    expect(fold).toContain('Person 5');
    expect(fold).toContain('Person 6');
  });
});

describe('B09 "Students here (N)" leaves ticked leaders out (ruling 4)', () => {
  it('a ticked leader is not counted or named; the label stays', () => {
    const h = setup(); // attendees: Ava (student) + Dana Testleader (leader)
    const g = h.get().LINK.groups[0];
    const out = strip(h.fns._lkReportHtml(g, g.lastReport));
    expect(out).toContain('Students here (1)Ava Example');
    expect(out).not.toContain('Dana Testleader');
  });
});

describe('B11 _lkFirstName with nothing after the comma', () => {
  it('"Smith," -> "Smith"; "Smith, Jo" -> "Jo"; plain and empty unchanged', () => {
    const h = setup();
    expect(h.fns._lkFirstName('Smith,')).toBe('Smith');
    expect(h.fns._lkFirstName('Smith,  ')).toBe('Smith');
    expect(h.fns._lkFirstName('Smith, Jo')).toBe('Jo');
    expect(h.fns._lkFirstName('Sam Smith')).toBe('Sam');
    expect(h.fns._lkFirstName('')).toBe('');
  });
});

describe('B12 two completeStep rows leaving the open list -> one ids=a1,a2 call; the next load asks nothing', () => {
  it('batches the ask and does not repeat it', async () => {
    const calls: string[] = [];
    const row = (id: string, oa: any) => ({ rowId: id, flowId: 'F1', flowName: 'New People', stepId: 'S2', stepName: 'Call', stepOrder: 2,
      personId: P(90), name: 'X, Y', consent: 'ok', dnc: false, openAction: oa });
    const fresh = (p: string) => {
      calls.push(p);
      if (p.startsWith('/link/actions')) return Promise.resolve([
        { id: 'a1', type: 'completeStep', status: 'sent', reason: null }, { id: 'a2', type: 'completeStep', status: 'sent', reason: null }]);
      return Promise.resolve({ rows: [row('r1', null), row('r2', null)], steps: [] });
    };
    const h = setup('L1', {}, { fresh });
    const L = h.get().LINK;
    L.flows = [row('r1', { id: 'a1', type: 'completeStep', status: 'pending', reason: null }),
      row('r2', { id: 'a2', type: 'completeStep', status: 'claimed', reason: null })];
    await h.fns._lkLoadFlows(true);
    expect(calls.filter((c) => c.startsWith('/link/actions'))).toEqual(['/link/actions?ids=a1,a2']);
    calls.length = 0;
    await h.fns._lkLoadFlows(true);
    expect(calls.filter((c) => c.startsWith('/link/actions'))).toEqual([]);
    expect(calls).toEqual(['/link/flows']);
  });
});

describe('B16 moving a draft onto a date that already has a draft switches to it (never overwrites)', () => {
  it('both drafts survive; the restored one has no stale error', () => {
    const h = setup();
    const L = h.get().LINK;
    h.fns._lkFormOpen('submit', '2026-10-06');
    const a = L.rf; a.ticks[P(61)] = true; a.err = 'Old error';
    h.fns._lkFormOpen('submit', '2026-10-05');
    const b = L.rf; b.ticks[P(63)] = true;
    expect(b).not.toBe(a);
    h.fns._lkRfDate('2026-10-06');
    expect(L.rf).toBe(a);
    expect(a.err).toBe('');
    expect(a.ticks).toEqual({ [P(61)]: true });
    expect(L.rfd[G(1) + '|2026-10-05']).toBe(b);
    expect(b.date).toBe('2026-10-05');
    expect(b.ticks).toEqual({ [P(63)]: true });
  });
  it('a free date still moves the draft', () => {
    const h = setup();
    const L = h.get().LINK;
    h.fns._lkFormOpen('submit', '2026-10-05');
    const b = L.rf;
    h.fns._lkRfDate('2026-10-06');
    expect(L.rf).toBe(b);
    expect(b.date).toBe('2026-10-06');
    expect(L.rfd[G(1) + '|2026-10-06']).toBe(b);
    expect(L.rfd[G(1) + '|2026-10-05']).toBeUndefined();
  });
});

describe('B24 Add student picker ignores taps for 400 ms after the list repaints (ruling 2)', () => {
  const pick = () => {
    const h = setup();
    const L = h.get().LINK;
    L.gm[G(1)] = { canEdit: true, members: [], changes: [] };
    L.youth = [{ personId: P(70), name: 'Tom LDummyton', grade: 11 }, { personId: P(71), name: 'Tom Other', grade: 11 }];
    L.yp = { gid: G(1), q: 'tom', grade: '' };
    h.calls.els['lk-yp-list'] = { innerHTML: '' };
    return h;
  };
  const adds = (h: any) => h.fns._lkQGet().filter((it: any) => it.type === 'addGroupMember');
  it('tap 100 ms after a repaint -> nothing queued; 500 ms -> queued', () => {
    vi.useFakeTimers();
    const h = pick();
    h.fns._lkYpDraw();
    vi.advanceTimersByTime(100);
    h.fns._lkYpAdd(P(70));
    expect(adds(h)).toHaveLength(0);
    vi.advanceTimersByTime(400); // 500 ms after the repaint
    h.fns._lkYpAdd(P(70));
    expect(adds(h)).toHaveLength(1);
  });
  it('the post-add hold stays, and the repaint that ends it starts a new 400 ms guard', () => {
    vi.useFakeTimers();
    const h = pick();
    h.fns._lkYpDraw();
    vi.advanceTimersByTime(500);
    h.fns._lkYpAdd(P(70));
    vi.advanceTimersByTime(450); // inside the 600 ms hold
    h.fns._lkYpAdd(P(71));
    expect(adds(h)).toHaveLength(1);
    vi.advanceTimersByTime(250); // 700 ms: the hold ended with a repaint at 600 ms, 100 ms ago
    h.fns._lkYpAdd(P(71));
    expect(adds(h)).toHaveLength(1);
    vi.advanceTimersByTime(350); // 450 ms after that repaint
    h.fns._lkYpAdd(P(71));
    expect(adds(h)).toHaveLength(2);
  });
});
