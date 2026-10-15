// fix16 lane E (Lifegroups): F-02(b), F-03, F-25, F-38, F-40(b), F-48(d), F-49, GAP-4. Harness copied from link.spa.test.ts
// (no lane may edit a shared test file), with the picker functions added.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['esc', 'progBar', '_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', 'moreItems', 'setMyLeaderId', '_vgSnap', '_vgActive',
  '_lkFresh', '_lkTime', '_lkDay', '_lkSvcLabel', '_lkPracticeLine', '_lkStatusText', '_lkStatusTone', '_lkCap', '_lkCapOff', '_lkLastSeen', '_lkSeen', '_lkOutsideWindow',
  '_lkBanner', '_lkKey', '_lkQGet', '_lkQSet', '_lkUuid', '_lkPush', '_lkSchedule', '_lkTakeBack', '_lkQueuedIdx', '_lkMerge', '_lkApply',
  '_lkBoot', '_lkDrain', '_lkActions', '_lkFlush', '_lkSwitchedOff', '_lkFailed', '_lkRetry', '_lkResults', '_lkPill', '_lkLogoutGuard', '_lkClear', '_lkSoftReset', '_lkOnPage',
  '_lkRefreshView', '_lkTop', '_lkSvc', '_lkFilter', '_lkLists', '_lkListHtml', '_lkDoneRowsHtml', '_lkDoneToggle', '_lkSetSearch', '_lkRowHtml', '_lkCheck', '_lkUndo',
  '_lkLeadersView', '_lkLeaderState', '_lkTickedCount', '_lkLeadersHtml', '_lkLeadersFoot', '_lkLeadersDraw',
  '_lkTickLeader', '_lkTickAll', '_lkLeadersSubmit', '_lkOpenLeaders', '_lkTickStop', '_lkStatusHtml',
  '_lkSwitchGuard', '_lkSwitchLeader', '_lkIamPick', '_lkIamListHtml', '_lkIamFilter', '_lkLoadLeaders', '_lkIamUse', '_lkMyName', '_lkAddDays', '_lkDefaultSvcFor',
  '_lkLastReportLabel', '_lkAddReport', '_lkGrFilter', '_lkWeekStart', '_lkWeeks', '_lkReports', '_lkReportOn', '_lkWeekReports', '_lkWeekReport', '_lkReportDateFor', '_lkReportHtml', '_lkWeekBodyHtml', '_lkWeekGo', '_lkGroup', '_lkGroupAct', '_lkGroupsHtml', '_lkSvcName', '_lkGroupHtml', '_lkNoteCount',
  '_lkFormHtml', '_lkPaintGroups', '_lkOpenGroup', '_lkGroupsBack', '_lkNewReport', '_lkEditReport', '_lkFormOpen',
  '_lkRfDate', '_lkRfDnm', '_lkRfTick', '_lkRfGuests', '_lkRfSvc', '_lkRfNote', '_lkReportSend', '_lkReportUndo', '_lkReportCancel',
  '_lkTapToast', '_lkToastDraw', '_lkToastUndo', '_lkSvcDay', '_lkNotToday', '_lkDayCheck', '_lkNoTonight', '_lkTakeServices', '_lkLoadPeople', '_lkPickService', '_lkPickHtml', '_lkPickFoot',   '_lkToday', '_lkFlowRow', '_lkFlowAct', '_lkFlowGroups', '_lkFirstName', '_lkSmsHref', '_lkTextHref', '_lkMyFlowRows', '_lkFlowDue', '_lkFlowRowHtml', '_lkFlowDrop', '_lkFlowsHtml', '_lkHomeFlowsHtml', '_lkCanComplete', '_lkAssign', '_lkRevLine', '_busGradeChip', 'fmtPhone', '_drop', 'helpTip', '_lkStepHtml', '_lkOpenStep', '_lkStepDraw', '_lkStepNote', '_lkStepSend',
  '_lkStepUndo', '_lkStepCancel', '_lkPaintFlows', '_lkStepActions', 'lgDisplayName', '_lkWord',
  'renderLink', '_lkTickStart', '_lkStatusLoad', '_lkHomeFlows', '_lkLoadFlows', '_lkAdmFresh', '_lkLastFriday', '_lkAt', '_lkLogWho', '_lkLogRowHtml', '_lkLogFile', '_lkLogAoa',
  '_lkLogExport', '_lkEvents', '_lkVerb', '_lkAdmStatusHtml', '_lkAdmMatchHtml', '_lkAdmShadowHtml', '_lkAdmLogListHtml', '_lkAdmLogHtml', '_lkAdminHtml',
  '_lkMembersHtml', '_lkMemberRows', '_lkMemOff', '_lkMembersLoad', '_lkYpDraw', '_lkMemQueue', '_lkMemRemove', '_lkMemKeep',
  // run 2026-10-15 lane B: DNC, flow filters, bulk Complete, Remove from step, console offline
  '_lkBoss', '_lkOfflineSince', '_lkOfflineHtml', '_lkFlowTypes', '_lkStepBlock', '_lkFlowFree', '_lkCanRemove', '_lkFlowVisible', '_lkFfGet',
  '_lkFfHtml', '_lkFfToggle', '_lkFlowShown', '_lkFlowBucket', '_lkTickable', '_lkSelIds', '_lkSel', '_lkSelAll', '_lkSelClear', '_lkFlowsDraw',
  '_lkBulkOpen', '_lkBulkSend', '_lkRemoveHtml', '_lkRemoveAsk', '_lkRemoveBack', '_lkRemoveSend', '_lkStepBtns', 'dncChip', 'dncBanner',
  '_structure', '_juniorMin', '_ikModuleOn', '_lkYpAdd', '_lkYpSet', '_lkYouthFilter', '_lkLoadGroups'];

const SVC = { serviceTimeId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222',
  name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16' };
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BODY = FNS.map((n) => extractFn(loadIndexHtml(), n)).join('\n');
// APP-49: the real constant, read from the page (a copy here would hide a change).
const LK_DOOR_TYPES_SRC = ['LK_DOOR_TYPES', 'LK_MEM_TYPES', 'LK_GROUP_TYPES', 'LK_FLOW_TYPES', 'LK_FF', 'LK_OFFLINE_MS']
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
  L.today = '2026-10-16'; L.services = RSVC; L.ldrs = [{ id: 'L1', fullName: 'Cody Cobb', active: true }];
  L.groups = [grp(over)]; L.gid = G(1);
  return h;
};

describe('F-02(b) Add student picker: one add per tap', () => {
  const pick = () => {
    const h = setup();
    const L = h.get().LINK;
    L.gm[G(1)] = { canEdit: true, members: [], changes: [] };
    L.youth = [{ personId: P(70), name: 'Tom LEstrange', grade: 11 }, { personId: P(71), name: 'Tom Other', grade: 11 }];
    L.yp = { gid: G(1), q: 'tom', grade: '' };
    h.calls.els['lk-yp-list'] = { innerHTML: '' };
    return h;
  };
  const adds = (h: any) => h.fns._lkQGet().filter((it: any) => it.type === 'addGroupMember');
  it('a second tap within 600 ms (on any row) queues nothing', () => {
    vi.useFakeTimers();
    const h = pick();
    h.fns._lkYpAdd(P(70));
    vi.advanceTimersByTime(150);
    h.fns._lkYpAdd(P(71)); // the next row slid under the finger
    h.fns._lkYpAdd(P(70));
    expect(adds(h)).toHaveLength(1);
    expect(adds(h)[0].payload.personId).toBe(P(70));
    vi.advanceTimersByTime(600);
    h.fns._lkYpAdd(P(71));
    expect(adds(h)).toHaveLength(2);
  });
  it('the tapped row stays in place greyed "Adding…" with no onclick, then leaves after 600 ms', () => {
    vi.useFakeTimers();
    const h = pick();
    h.fns._lkYpAdd(P(70));
    const el = h.calls.els['lk-yp-list'];
    expect(strip(el.innerHTML)).toContain('Tom LEstrangeAdding…');
    expect(el.innerHTML).not.toContain(`_lkYpAdd('${P(70)}')`);
    expect(el.innerHTML.indexOf('Tom LEstrange')).toBeLessThan(el.innerHTML.indexOf('Tom Other'));
    vi.advanceTimersByTime(650);
    expect(el.innerHTML).not.toContain('Tom LEstrange');
    expect(el.innerHTML).toContain('Tom Other');
  });
});
