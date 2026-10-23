// Elvanto link SPA (plan Tasks F1.1–F1.4). Extract-and-run: the REAL functions from public/index.html run against
// small stubs (localStorage, API, modal). No server: /link routes are stubbed with the spec's response shapes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIndexHtml, extractFn, loadFns, SITE_TIME_SRC } from './helpers/extract-fn';

const FNS = ['esc', 'progBar', '_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', 'moreItems', 'setMyLeaderId', '_vgSnap', '_vgActive',
  '_lkFresh', '_lkTime', '_lkDay', 'fmtDay', '_lkSvcLabel', '_lkStatusText', '_lkStatusTone', '_lkCap', '_lkCapOff', '_lkLastSeen', '_lkSeen', '_lkOutsideWindow',
  '_lkBanner', '_lkKey', '_lkQGet', '_lkQSet', '_lkUuid', '_lkPush', '_lkSchedule', '_lkTakeBack', '_lkQueuedIdx', '_lkMerge', '_lkApply',
  '_lkBoot', '_lkDrain', '_lkActions', '_lkFlush', '_lkSwitchedOff', '_lkFailed', '_lkRetry', '_lkResults', '_lkPill', '_lkLogoutGuard', '_lkClear', '_lkSoftReset', '_lkOnPage',
  '_lkRefreshView', '_lkTop', '_lkSvc', '_lkFilter', '_lkLists', '_lkListHtml', '_lkDoneRowsHtml', '_lkDoneToggle', '_lkSetSearch', '_lkRowHtml', '_lkCheck', '_lkUndo',
  '_lkLeadersView', '_lkLeaderState', '_lkTickedCount', '_lkLeadersHtml', '_lkLeadersFoot', '_lkLeadersDraw',
  '_lkTickLeader', '_lkTickAll', '_lkLeadersSubmit', '_lkOpenLeaders', '_lkTickStop', '_lkStatusHtml',
  '_lkSwitchGuard', '_lkSwitchLeader', '_lkIamPick', '_lkIamListHtml', '_lkIamFilter', '_lkLoadLeaders', '_lkIamUse', '_lkMyName', '_lkAddDays',
  '_lkLastReportLabel', '_lkAddReport', '_lkGrFilter', '_lkWeekStart', '_lkWeeks', '_lkReports', '_lkReportOn', '_lkWeekReports', '_lkWeekReport', '_lkReportDateFor', '_lkReportHtml', '_lkWeekBodyHtml', '_lkWeekGo', '_lkGroup', '_lkGroupAct', '_lkGroupsHtml', '_lkGroupHtml', '_lkNoteCount',
  '_lkFormHtml', '_lkPaintGroups', '_lkOpenGroup', '_lkGroupsBack', '_lkNewReport', '_lkEditReport', '_lkFormOpen',
  '_lkRfDate', '_lkRfDnm', '_lkRfTick', '_lkRfGuests', '_lkRfSvc', '_lkRfNote', '_lkReportSend', '_lkReportUndo', '_lkReportCancel', '_lkDraftKey', '_lkDraftGet', '_lkDraftDrop',
  '_lkTapToast', '_lkToastDraw', '_lkToastUndo', '_lkSvcDay', '_lkNotToday', '_lkDayCheck', '_lkNoTonight', '_lkTakeServices', '_lkLoadPeople', '_lkPickService', '_lkPickHtml', '_lkPickFoot',   '_lkToday', '_lkFlowRow', '_lkFlowAct', '_lkFlowGroups', '_lkFirstName', '_lkSmsHref', '_lkTextHref', '_lkMyFlowRows', '_lkFlowDue', '_lkFlowRowHtml', '_lkFlowDrop', '_lkFlowsHtml', '_lkHomeFlowsHtml', '_lkCanComplete', '_lkHubOwned', '_lkReassign', '_lkFits', '_lkPickList', '_lkPicked', '_lkAssignSave', '_lkRevLine', '_busGradeChip', 'fmtPhone', '_drop', 'helpTip', '_lkStepHtml', '_lkOpenStep', '_lkStepDraw', '_lkStepNote', '_lkStepSend',
  '_lkStepUndo', '_lkStepCancel', '_lkPaintFlows', '_lkStepActions', 'lgDisplayName', '_lkWord',
  'renderLink', '_lkTickStart', '_lkStatusLoad', '_lkHomeFlows', '_lkLoadFlows', '_lkAdmFresh', '_lkLastFriday', '_lkAt', '_lkLogWho', '_lkLogRowHtml', '_lkLogFile', '_lkLogAoa',
  '_lkLogExport', '_lkEvents', '_lkVerb', '_lkRcHtml', '_lkRcDone', '_lkRcType', '_lkAdmStatusHtml', '_lkAdmMatchHtml', '_lkAdmCreate', '_lkAdmLoadRoster', '_lkAdmDraw', '_lkAdmLogListHtml', '_lkAdmLogHtml', '_lkAdminHtml',
  '_lkMembersHtml', '_lkMemberRows', '_lkMemOff', '_lkMembersLoad', '_lkYpDraw', '_lkMemQueue', '_lkMemRemove', '_lkMemKeep',
  // run 2026-10-15 lane B: DNC, flow filters, bulk Complete, Remove from step, console offline
  '_lkBoss', '_lkOfflineSince', '_lkOfflineHtml', '_lkFlowTypes', '_lkStepBlock', '_lkConsentWait', '_lkNotReceived', '_lkNotReceivedText', '_lkFlowFree', '_lkCanRemove', '_lkFlowVisible', '_lkFlowKind', '_lkFirstStep', '_lkFfGet',
  '_lkFfHtml', '_lkFfToggle', '_lkFlowShown', '_lkFlowBucket', '_lkTickable', '_lkSelIds', '_lkSel', '_lkSelAll', '_lkSelClear', '_lkFlowsDraw',
  '_lkBulkOpen', '_lkBulkSend', '_lkRemoveHtml', '_lkRemoveAsk', '_lkRemoveBack', '_lkRemoveSend', '_lkStepBtns', 'dncChip', 'dncBanner',
  '_structure', '_juniorMin', '_ikModuleOn'];

const SVC = { serviceTimeId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222',
  name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16' };
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BODY = SITE_TIME_SRC + '\n' + FNS.map((n) => extractFn(loadIndexHtml(), n)).join('\n');
// APP-49: the real constant, read from the page (a copy here would hide a change).
const LK_DOOR_TYPES_SRC = ['LK_DOOR_TYPES', 'LK_MEM_TYPES', 'LK_GROUP_TYPES', 'LK_FLOW_TYPES', 'LK_FF', 'LK_OFFLINE_MS']
  .map((n) => loadIndexHtml().match(new RegExp(`^const ${n} = .*;`, 'm'))![0]).join('\n');

interface Env { storage: Map<string, string>; failStorage?: boolean; quota?: boolean; post?: (path: string, body: any, ms?: number) => Promise<any>;
  fresh?: (path: string) => Promise<any>;
  role?: string; mode?: string; modules?: Record<string, string>; leaderId?: string | null; }

function makeEnv(e: Partial<Env> = {}) {
  const env: Env = { storage: e.storage ?? new Map(), ...e } as Env;
  const calls = { posts: [] as any[], toasts: [] as string[], modals: [] as string[], closed: 0, asks: [] as string[], apps: [] as string[], gos: [] as string[] };
  const ls = {
    getItem: (k: string) => { if (env.failStorage) throw new Error('blocked'); return env.storage.has(k) ? env.storage.get(k)! : null; },
    setItem: (k: string, v: string) => { if (env.failStorage) throw new Error('blocked'); if (env.quota) throw new Error('QuotaExceededError'); env.storage.set(k, String(v)); },
    key: (i: number) => [...env.storage.keys()][i] ?? null,
    __fresh: (p: string) => (env.fresh ? env.fresh(p) : Promise.reject(new Error('no'))),
    get length() { return env.storage.size; },
    removeItem: (k: string) => { if (env.failStorage) throw new Error('blocked'); env.storage.delete(k); },
  };
  const prelude = `
    const _LK_RC = {}; // L7
    const navPush = () => {};
    const S = { user: { id: 'u1', role: ${JSON.stringify(env.role ?? 'grade')} }, page: 'home',
      settings: { ministryConfig: { modules: Object.assign({ newYouthForms: ${JSON.stringify(env.mode ?? 'on')} }, ${JSON.stringify(env.modules ?? {})}) } } };
    let LINK = _lkFresh();
    ${LK_DOOR_TYPES_SRC}
    const localStorage = __ls;
    const navigator = { userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' };
    const document = { getElementById: () => null, visibilityState: 'visible' };
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

// ── F1.1 shared parts ──
describe('F1.1 switch and More entries', () => {
  it('_linkOn(): any link feature usable; a missing key inherits New person', () => {
    for (const role of ['admin', 'director', 'quad', 'grade', 'leader']) {
      expect(makeEnv({ role, mode: 'off' }).fns._linkOn()).toBe(false);
      expect(makeEnv({ role, mode: 'admin' }).fns._linkOn()).toBe(role === 'admin');
      expect(makeEnv({ role, mode: 'on' }).fns._linkOn()).toBe(true);
      for (const f of ['checkin', 'lifegroupReport', 'flows']) expect(makeEnv({ role, mode: 'on' }).fns._linkOn(f), f).toBe(true);
    }
  });
  it('_linkOn(feature): each feature has its own switch; admin is admin only', () => {
    const on = (role: string, modules: Record<string, string>, f?: string) => makeEnv({ role, mode: 'off', modules }).fns._linkOn(f);
    expect(on('grade', { checkin: 'on' }, 'checkin')).toBe(true);
    expect(on('grade', { checkin: 'on' }, 'flows')).toBe(false);
    expect(on('grade', { checkin: 'on' }, 'lifegroupReport')).toBe(false);
    expect(on('grade', { checkin: 'on' })).toBe(true); // any
    expect(on('grade', { flows: 'admin' }, 'flows')).toBe(false);
    expect(on('admin', { flows: 'admin' }, 'flows')).toBe(true);
    expect(on('admin', { lifegroupReport: 'off', flows: 'on' }, 'lifegroupReport')).toBe(false);
    // an explicit off beats an inherited on
    expect(makeEnv({ role: 'grade', mode: 'on', modules: { checkin: 'off' } }).fns._linkOn('checkin')).toBe(false);
    expect(makeEnv({ role: 'grade', mode: 'on', modules: { checkin: 'off' } }).fns._linkOn('flows')).toBe(true);
  });
  it('_linkAdminOn: the admin login whatever the switches say, nobody else', () => {
    for (const mode of ['off', 'admin', 'on']) {
      expect(makeEnv({ role: 'admin', mode }).fns._linkAdminOn(), mode).toBe(true);
      for (const role of ['director', 'quad', 'grade', 'leader']) expect(makeEnv({ role, mode }).fns._linkAdminOn(), role + mode).toBe(false);
    }
  });
  it('moreItems per role and mode', () => {
    const ids = (role: string, mode: string, modules?: Record<string, string>) => makeEnv({ role, mode, modules }).fns.moreItems().map((m: any) => m.id).filter((id: string) => id.startsWith('link-'));
    expect(ids('admin', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows']); // 2026-10-14: Elvanto link is an Admin tab, not a More entry
    expect(ids('director', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows']);
    expect(ids('quad', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows']);
    expect(ids('grade', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows']);
    expect(ids('leader', 'on')).toEqual(['link-checkin']);
    expect(ids('admin', 'admin')).toEqual(['link-checkin', 'link-groups', 'link-flows']);
    for (const role of ['director', 'quad', 'grade', 'leader']) expect(ids(role, 'admin')).toEqual([]);
    for (const role of ['director', 'quad', 'grade', 'leader']) expect(ids(role, 'off')).toEqual([]);
    expect(ids('admin', 'off')).toEqual([]);
    // each entry by its own switch
    expect(ids('grade', 'off', { lifegroupReport: 'on' })).toEqual(['link-groups']);
    expect(ids('grade', 'off', { flows: 'on', checkin: 'on' })).toEqual(['link-checkin', 'link-flows']);
    expect(ids('leader', 'off', { lifegroupReport: 'on', flows: 'on' })).toEqual([]);
  });
  it('Youth Setup shows four Off / Admin only / On selects with plain labels, and the draft keeps all four keys', () => {
    expect(html).toContain("onchange=\"_setupSetModule('${k}', this.value)\"");
    for (const label of ["'New person'", "'Check-in'", "'Lifegroup report'", "'Flow steps'"]) expect(html).toContain(label);
    expect(html).toContain("checkin: 'off', lifegroupReport: 'off', flows: 'off'");
  });
  it('D9: the admin-only state is "admin" ("Admin only"); a legacy "shadow" still reads as admin only', () => {
    expect(html).toContain("[['off', 'Off'], ['admin', 'Admin only'], ['on', 'On']]");
    expect(html).not.toContain("'Shadow (admin only)'");
    for (const role of ['admin', 'director', 'grade']) {
      expect(makeEnv({ role, mode: 'shadow' }).fns._linkOn(), role).toBe(role === 'admin');
      expect(makeEnv({ role, mode: 'off', modules: { flows: 'shadow' } }).fns._linkOn('flows'), role).toBe(role === 'admin');
    }
    const { _nyModeOf } = loadFns(['_nyModeOf']);
    expect(['shadow', 'admin', 'on', true, 'off', false, undefined].map(_nyModeOf)).toEqual(['admin', 'admin', 'on', 'on', 'off', 'off', 'off']);
  });
  it('link pages are routed, and a junior leader may open the door screen only', () => {
    expect(html).toContain("else if (String(p).indexOf('link-') === 0) await renderLink(p);");
    expect(html).toContain("['home','my-students','at-risk','prayers','birthdays','bus','new-youth'].includes(p) && p !== 'link-checkin'");
  });
});

describe('F1.1 _lkStatusText (contract §5.3 / §5.4 word for word)', () => {
  const t = makeEnv().fns._lkStatusText;
  it('every status', () => {
    expect(t({ status: 'pending', reason: null })).toBe('Waiting for Elvanto.');
    expect(t({ status: 'pending', reason: null }, '7:02 pm')).toBe('Waiting for Elvanto. Elvanto last reached 7:02 pm');
    expect(t({ status: 'pending', reason: 'awaiting-approval' })).toBe('Waiting for the new-person form to be approved.');
    expect(t({ status: 'claimed' })).toBe('Sending to Elvanto…');
    expect(t({ status: 'sent', reason: null, resultAt: '2026-10-16T09:02:00.000Z' })).toBe('In Elvanto 7:02 pm');
    expect(t({ status: 'sent', reason: 'already' })).toBe('Already in Elvanto');
    expect(t({ status: 'unclear', reason: 'lease-lost' })).toBe('Not sure it saved. The admin is checking Elvanto.');
    expect(t({ status: 'cancelled' })).toBe('Cancelled.');
    expect(t({ status: 'queued' })).toBe('Waiting to send.');
    expect(t({ status: 'mirror' })).toBe('In Elvanto.');
  });
  it('every refusal reason', () => {
    const lines: Record<string, string> = {
      'locked': "This isn't connected yet. Do it in Elvanto.",
      'no-room': "No check-in room found for this person. Tap again in a few minutes, or check in on the kiosk.",
      'person-unknown': "This person isn't in Elvanto any more.",
      'report-exists': "There's already a report for that date. Edit it.",
      'report-not-found': 'This report changed in Elvanto. Reload and try again.',
      'report-changed': 'This report changed in Elvanto. Reload and try again.',
      'member-left': "Someone ticked isn't in this group now. Reload.",
      'not-in-group': "Someone ticked isn't in this group now. Reload.",
      'multi-service': 'Edit this report in Elvanto.',
      'unkept-notes': 'Edit this report in Elvanto.',
      'note-too-long': 'Edit this report in Elvanto.',
      'service-not-offered': "Elvanto doesn't offer that service for this date. Pick another, or do it in Elvanto.",
      'did-not-meet-conflict': 'Untick everyone, or untick Group did not meet.',
      'step-moved': 'This step changed in Elvanto. Reload and try again.',
      'assignee-needed': "Pick who gets the next step, or Elvanto's usual pick, then Complete again.",
      'ambiguous-first-timer': 'Two new people have this name. Check in on the kiosk.',
      'too-old': 'Too late to send. Do it in Elvanto.',
      'not-landed': "It didn't save. Do it in Elvanto.",
      'console-cannot-read': 'This did not go through. Do it in Elvanto.',
      'unknown': 'This did not go through. Do it in Elvanto.',
      'lease-lost': 'Not sure it saved. The admin is checking Elvanto.',
      'note-unreadable': "This note couldn't be read. Do it in Elvanto.",
    };
    for (const [reason, line] of Object.entries(lines)) expect(t({ status: 'refused', reason })).toBe(line);
    expect(t({ status: 'refused', reason: null, message: 'Do this in Elvanto for now.' })).toBe('Do this in Elvanto for now.');
  });
});

describe('A3 / X9 lines by action type', () => {
  const t = makeEnv().fns._lkStatusText;
  it('check-out no-room and flow-step already', () => {
    expect(t({ status: 'refused', type: 'checkOut', reason: 'no-room' })).toBe('Checked in with no room, so there is nothing to check out.'); // T6 (2026-10-21)
    expect(t({ status: 'refused', type: 'checkIn', reason: 'no-room' })).toBe("No check-in room found for this person. Tap again in a few minutes, or check in on the kiosk.");
    expect(t({ status: 'sent', type: 'completeStep', reason: 'already' })).toBe("Done once already. If it's back on the list, do it in Elvanto.");
    expect(t({ status: 'sent', type: 'checkIn', reason: 'already' })).toBe('Already in Elvanto');
  });
  it('S1: a shadow capability no longer raises a practice banner (practice mode is gone)', () => {
    const st = (caps: any) => ({ console: { lastSeenAt: '2026-10-16T06:12:00.000Z', online: true, inWindow: true, pollSeconds: 60,
      capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', ...caps }, consoles: 1 }, mirrors: {} });
    expect(strip(makeEnv().fns._lkBanner(['checkIn', 'checkOut'], st({ checkOut: 'shadow' })))).not.toContain('Practice');
  });
});

describe('F1.1 _lkBanner', () => {
  const st = (c: any) => ({ console: { lastSeenAt: '2026-10-16T06:12:00.000Z', online: true, inWindow: true, pollSeconds: 60,
    capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live' }, consoles: 1, ...c }, mirrors: {} });
  const caps = (x: any) => ({ checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', ...x });
  it('offline shows the last-seen time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T09:00:00.000Z'));
    try {
      expect(strip(makeEnv().fns._lkBanner(['checkIn'], st({ online: false })))).toContain('No link to Elvanto since 4:12 pm. Your taps send later. Use the kiosk too.'); // fix16 F-12 wording
    } finally { vi.useRealTimers(); }
  });
  it('T-17 / APP-52: a last-seen time on another day carries the day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z')); // Mon 10:00 Brisbane
    try {
      expect(strip(makeEnv().fns._lkBanner(['checkIn'], st({ online: false })))).toContain('No link to Elvanto since Fri 16 Oct, 4:12pm.'); // fix16 F-12 wording
      const h = makeEnv();
      h.get().LINK.status = st({ online: false });
      expect(h.fns._lkLastSeen()).toBe('Fri 16 Oct, 4:12pm');
    } finally { vi.useRealTimers(); }
  });
  it('live says nothing, off hides; no capability line (S1, X-2)', () => {
    const b = strip(makeEnv().fns._lkBanner(['checkIn', 'checkOut'], st({ capabilities: caps({ checkIn: 'live', checkOut: 'live' }) })));
    expect(b).toBe('');
    const off = makeEnv().fns._lkBanner(['checkIn', 'checkOut'], st({ capabilities: caps({ checkOut: 'off' }) }));
    expect(off).toBe('');
  });
  it('an off type hides its button on the door', () => {
    const h = makeEnv();
    h.get().LINK.status = st({ capabilities: caps({ checkIn: 'off' }) });
    h.get().LINK.svc = SVC.serviceTimeId;
    const row = h.fns._lkRowHtml({ personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, action: null, mine: false });
    expect(row).not.toContain('Check in');
  });
  it('RFIX: a row shown from the pushed name only (noRoster) has Check out but never Check in', () => {
    const h = makeEnv();
    h.get().LINK.status = st({ capabilities: caps({}) });
    h.get().LINK.svc = SVC.serviceTimeId;
    const p = { personId: P(1), name: 'Zed Zulu', grade: null, leader: false, action: null, mine: false, noRoster: true };
    expect(h.fns._lkRowHtml({ ...p, checkedIn: true })).toContain('Check out');
    const out = h.fns._lkRowHtml({ ...p, checkedIn: false });
    expect(out).not.toContain('Check in');
    expect(out).not.toContain("_lkCheck('" + P(1) + "','checkIn')");
  });
  it('"2 consoles are running" for admin only', () => {
    expect(strip(makeEnv({ role: 'admin' }).fns._lkBanner(['checkIn'], st({ consoles: 2 })))).toContain('2 consoles are running');
    expect(strip(makeEnv({ role: 'director' }).fns._lkBanner(['checkIn'], st({ consoles: 2 })))).not.toContain('consoles are running');
  });
  it('nothing before the status has loaded', () => {
    expect(makeEnv().fns._lkBanner(['checkIn'], null)).toBe('');
  });
});

// ── F1.2 the phone queue ──
function door(h: ReturnType<typeof makeEnv>, people: any[] = [], leaders: any[] = []) {
  const L = h.get().LINK;
  L.services = [{ ...SVC, ymd: h.fns._lkSvcDay() }]; L.svc = SVC.serviceTimeId; L.people[SVC.serviceTimeId] = { people, leaders }; // fix16 F-28: today, so Check out shows
  L.okDay = { [SVC.serviceTimeId]: true }; // B9: the "Not today" confirm is tested on its own
}

describe('F1.2 queue', () => {
  it('a tap is queued with a crypto.randomUUID id and survives a reload (fresh functions, same storage)', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID');
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkIn');
    expect(spy).toHaveBeenCalled();
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'action', type: 'checkIn', note: null, leaderId: null,
      payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, personId: P(1) } });
    expect(q[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const reloaded = makeEnv({ storage: h.env.storage });
    expect(reloaded.fns._lkQGet()).toEqual(q);
    expect([...h.env.storage.keys()]).toEqual(['ysc.lkq.u1']);
    spy.mockRestore();
  });
  it('tapping again while queued removes it locally; nothing is sent', async () => {
    vi.useFakeTimers();
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkIn');
    h.fns._lkUndo(P(1));
    expect(h.fns._lkQGet()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.calls.posts).toHaveLength(0);
  });
  it('a blocked localStorage never blocks a tap (kept in memory)', () => {
    vi.useFakeTimers();
    const h = makeEnv({ failStorage: true });
    door(h, [{ personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    expect(() => h.fns._lkCheck(P(1), 'checkIn')).not.toThrow();
    expect(h.fns._lkQGet()).toHaveLength(1);
  });
  it('flush sends at most 50 per POST, one flush at a time, 20 s timeout, no local-only fields', async () => {
    let release!: (v: any) => void;
    const h = makeEnv({ post: (_p, b) => new Promise((r) => { release = () => r({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'saved' })) }); }) });
    const q = Array.from({ length: 60 }, (_, i) => ({ kind: 'action', id: P(100 + i), type: 'checkIn', payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, personId: P(i) }, note: null, leaderId: null, _x: 1 }));
    h.fns._lkQSet(q);
    vi.useFakeTimers();
    const a = h.fns._lkFlush(), b = h.fns._lkFlush();
    expect(a).toBe(b);
    expect(h.calls.posts).toHaveLength(1);
    expect(h.calls.posts[0].p).toBe('/link/batch');
    expect(h.calls.posts[0].ms).toBe(20000);
    expect(h.calls.posts[0].b.items).toHaveLength(50);
    expect(h.calls.posts[0].b.items[0]._x).toBeUndefined();
    expect(h.calls.posts[0].b.device).toEqual({ id: 'dev-1', label: 'iPhone · Safari' });
    release(null);
    await a;
    expect(h.fns._lkQGet()).toHaveLength(10);
  });
  it('B8 / T-39: each queued item is stamped _at; the flush sends it as queuedAt, with sentAt on the envelope', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T09:00:00.000Z'));
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkIn');
    expect(h.fns._lkQGet()[0]._at).toBe('2026-10-16T09:00:00.000Z');
    h.fns._lkQSet([...h.fns._lkQGet(), { v: 1, kind: 'action', id: P(60), type: 'checkIn', payload: {}, note: null, leaderId: null }]);
    vi.setSystemTime(new Date('2026-10-16T09:30:00.000Z'));
    await h.fns._lkFlush();
    const b = h.calls.posts[0].b;
    expect(b.sentAt).toBe('2026-10-16T09:30:00.000Z');
    expect(b.items[0].queuedAt).toBe('2026-10-16T09:00:00.000Z');
    expect(b.items[0]._at).toBeUndefined();
    expect('queuedAt' in b.items[1]).toBe(false); // an old item with no _at counts as now on the server
  });
  it('B8: a stale refusal reads "Someone else changed this after your tap. Reload."', () => {
    const t = makeEnv().fns._lkStatusText;
    expect(t({ status: 'refused', reason: 'stale' })).toBe('Someone else changed this after your tap. Reload.');
  });
  it('saved/replay take the server status; duplicate adopts existingId', async () => {
    const people = [1, 2, 3].map((n) => ({ personId: P(n), name: 'P' + n, grade: 8, leader: false, checkedIn: false, action: null, mine: false }));
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: [
      { id: b.items[0].id, kind: 'action', outcome: 'saved', action: { id: b.items[0].id, type: 'checkIn', status: 'pending', reason: null } },
      { id: b.items[1].id, kind: 'action', outcome: 'replay', action: { id: b.items[1].id, type: 'checkIn', status: 'sent', reason: null } },
      { id: b.items[2].id, kind: 'action', outcome: 'duplicate', existingId: P(999) },
    ] }) });
    door(h, people);
    vi.useFakeTimers();
    for (const n of [1, 2, 3]) h.fns._lkCheck(P(n), 'checkIn');
    await h.fns._lkFlush();
    expect(h.fns._lkQGet()).toEqual([]);
    const d = h.get().LINK.people[SVC.serviceTimeId].people;
    expect(d[0]).toMatchObject({ checkedIn: true, mine: true, action: { status: 'pending' } });
    expect(d[1]).toMatchObject({ checkedIn: true, action: { status: 'sent' } });
    expect(d[2]).toMatchObject({ checkedIn: true, action: { id: P(999), type: 'checkIn' } });
  });
  it('B4: a check-out answered cancelled shows the row out; a refused check-out says why (the row stays in)', async () => {
    const people = [1, 2].map((n) => ({ personId: P(n), name: 'P' + n, grade: 8, leader: false, checkedIn: true,
      action: { id: P(500 + n), type: 'checkIn', status: 'pending', reason: null }, mine: false }));
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: [
      { id: b.items[0].id, kind: 'action', outcome: 'cancelled', action: { id: P(501), type: 'checkIn', status: 'cancelled', reason: null } },
      { id: b.items[1].id, kind: 'action', outcome: 'refused', code: 'LINK_STILL_SENDING', message: 'Still sending, try again in a minute.' },
    ] }) });
    door(h, people);
    vi.useFakeTimers();
    h.fns._lkCheck(P(1), 'checkOut'); h.fns._lkCheck(P(2), 'checkOut');
    await h.fns._lkFlush();
    const d = h.get().LINK.people[SVC.serviceTimeId].people;
    expect(d[0]).toMatchObject({ checkedIn: false, action: { id: P(501), status: 'cancelled' } });
    expect(d[1]).toMatchObject({ checkedIn: true });
    expect(h.calls.toasts).toContain('Still sending, try again in a minute.');
  });
  it('RATE_LIMITED stays queued and toasts; a final refusal shows the reason on the row', async () => {
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: [
      { id: b.items[0].id, kind: 'action', outcome: 'refused', code: 'RATE_LIMITED', message: 'slow down' },
      { id: b.items[1].id, kind: 'action', outcome: 'refused', code: 'LINK_UNAVAILABLE', message: 'Do this in Elvanto for now.' },
    ] }) });
    door(h, [1, 2].map((n) => ({ personId: P(n), name: 'P' + n, grade: 8, leader: false, checkedIn: false, action: null, mine: false })));
    vi.useFakeTimers();
    h.fns._lkCheck(P(1), 'checkIn'); h.fns._lkCheck(P(2), 'checkIn');
    await h.fns._lkFlush();
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(1);
    expect(q[0].payload.personId).toBe(P(1));
    expect(h.calls.toasts).toContain('Too many taps. Wait a minute.');
    const row = h.fns._lkRowHtml(h.get().LINK.people[SVC.serviceTimeId].people[1]);
    expect(strip(row)).toContain('Tell the admin.'); // fix16 F-35: a grade login is told to pass it on
    expect(strip(row)).toContain('Check in');
  });
  it('network errors back off 5 s, 15 s, 45 s, then 60 s; the pill turns red after the 45 s step fails', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: () => Promise.reject(new Error("Can't reach the server")) });
    h.fns._lkQSet([{ kind: 'action', id: P(50), type: 'checkIn', payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, personId: P(1) }, note: null, leaderId: null }]);
    await h.fns._lkFlush();
    expect(h.calls.posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4999); expect(h.calls.posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.calls.posts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(14999); expect(h.calls.posts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(h.calls.posts).toHaveLength(3);
    expect(h.fns._lkPill()).toContain('1 waiting to send');
    await vi.advanceTimersByTimeAsync(44999); expect(h.calls.posts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1); expect(h.calls.posts).toHaveLength(4);
    expect(strip(h.fns._lkPill())).toBe('Not saved — tap to retry');
    await vi.advanceTimersByTimeAsync(60000); expect(h.calls.posts).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(60000); expect(h.calls.posts).toHaveLength(6);
    expect(h.fns._lkQGet()).toHaveLength(1);
  });
  it('A7 / APP-17: 404 MODULE_DISABLED stops the retry, keeps the queue, says so and leaves the link page', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: () => Promise.reject(Object.assign(new Error('Not found'), { status: 404, code: 'MODULE_DISABLED' })) });
    h.get().S.page = 'link-checkin';
    const ci = (n: number) => ({ kind: 'action', v: 1, id: P(60 + n), type: 'checkIn', payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, personId: P(n) }, note: null, leaderId: null });
    h.fns._lkQSet([ci(1), ci(2), { kind: 'identity', id: P(70), at: '2026-10-16T08:00:00.000Z', from: null, to: P(8) }]);
    await h.fns._lkFlush();
    expect(h.calls.toasts).toContain('Check-in is switched off. Use the kiosk. 2 taps were not sent.');
    expect(h.calls.gos).toContain('home');
    await vi.advanceTimersByTimeAsync(300000);
    expect(h.calls.posts).toHaveLength(1);
    expect(h.fns._lkQGet()).toHaveLength(3);
    expect(h.get().LINK.red).toBe(false);
  });
  it('A7: queue items carry v: 1', () => {
    vi.useFakeTimers();
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkIn');
    h.fns.setMyLeaderId(P(8));
    for (const it of h.fns._lkQGet()) expect(it.v).toBe(1);
  });
  it('"All saved" once the queue empties', async () => {
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'logged' })) }) });
    h.fns._lkQSet([{ kind: 'identity', id: P(7), at: '2026-10-16T08:00:00.000Z', from: null, to: P(8) }]);
    await h.fns._lkFlush();
    expect(strip(h.fns._lkPill())).toBe('All saved');
  });
  it('undo after send queues an undo (check-in) and cancels map back onto the row', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'undo', outcome: 'cancelled' }] }) });
    door(h, [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: true, mine: true, action: { id: P(40), type: 'checkIn', status: 'pending', reason: null } }]);
    h.fns._lkUndo(P(1));
    const q = h.fns._lkQGet();
    expect(q[0]).toMatchObject({ kind: 'undo', id: P(40), leaderId: null });
    expect(q[0].newId).toMatch(/^[0-9a-f-]{36}$/);
    await h.fns._lkFlush();
    expect(h.calls.posts[0].b.items[0]._s).toBeUndefined();
    expect(h.get().LINK.people[SVC.serviceTimeId].people[0]).toMatchObject({ checkedIn: false, action: { status: 'cancelled' } });
  });
  it('B7 / T-38: a tap on an item in flight queues an undo; it resolves saved and the undo stays queued', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const h = makeEnv({ post: (_p, b) => new Promise((r) => { release = () => r({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind,
      outcome: 'saved', action: { id: i.id, type: i.type, status: 'pending', reason: null }, mine: true })) }); }) });
    door(h, [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkIn');
    const first = h.fns._lkQGet()[0];
    const f = h.fns._lkFlush();
    vi.advanceTimersByTime(600); // fix16 F-02: a second tap on the same row within 600 ms is ignored
    h.fns._lkCheck(P(1), 'checkIn'); // the second tap lands while the first is on the wire
    release();
    await f;
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'undo', id: first.id });
    // the row shows the queued check-out, not "in"
    const merged = h.fns._lkMerge(h.get().LINK.people[SVC.serviceTimeId].people, q, SVC.serviceTimeId);
    expect(merged[0]).toMatchObject({ checkedIn: false, queued: true });
  });
  it('B7: a report or step in flight gets a cancel item instead of being removed', async () => {
    let release!: () => void;
    const h = makeEnv({ post: () => new Promise((r) => { release = () => r({ results: [] }); }) });
    h.get().LINK.gid = P(9);
    h.get().LINK.groups = [{ groupId: P(9), name: 'G', meets: '', members: [], thisWeek: 'none', lastReport: null, openAction: null }];
    h.fns._lkQSet([{ v: 1, kind: 'action', id: P(70), type: 'submitReport', payload: { groupId: P(9) }, note: null, leaderId: P(5) },
      { v: 1, kind: 'action', id: P(71), type: 'completeStep', payload: { rowId: P(8) }, note: null, leaderId: P(5), _f: P(8) }]);
    const f = h.fns._lkFlush();
    h.fns._lkReportUndo();
    h.fns._lkStepUndo(P(8));
    release(); await f;
    const q = h.fns._lkQGet();
    expect(q.filter((x: any) => x.kind === 'cancel')).toEqual([
      expect.objectContaining({ kind: 'cancel', id: P(70), leaderId: P(5), _g: P(9) }),
      expect.objectContaining({ kind: 'cancel', id: P(71), leaderId: P(5), _f: P(8) })]);
  });
  it('B7 / APP-51: an undo answered replay or duplicate is handled like saved', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: [
      { id: b.items[0].id, kind: 'undo', outcome: 'replay', action: { id: P(91), type: 'checkOut', status: 'pending', reason: null } },
      { id: b.items[1].id, kind: 'undo', outcome: 'duplicate', existingId: P(92), action: { id: P(92), type: 'checkOut', status: 'claimed', reason: null } },
    ] }) });
    door(h, [1, 2].map((n) => ({ personId: P(n), name: 'P' + n, grade: 7, leader: false, checkedIn: true, mine: true,
      action: { id: P(40 + n), type: 'checkIn', status: 'pending', reason: null } })));
    h.fns._lkUndo(P(1)); h.fns._lkUndo(P(2));
    await h.fns._lkFlush();
    const d = h.get().LINK.people[SVC.serviceTimeId].people;
    expect(d[0]).toMatchObject({ checkedIn: false, action: { id: P(91), type: 'checkOut' } });
    expect(d[1]).toMatchObject({ checkedIn: false, action: { id: P(92), type: 'checkOut', status: 'claimed' } });
  });
  it('too-late on a cancel says so; LINK_NOT_YOURS shows its message', async () => {
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'cancel', outcome: 'too-late' }] }) });
    h.fns._lkQSet([{ kind: 'cancel', id: P(41), leaderId: null }]);
    await h.fns._lkFlush();
    expect(h.calls.toasts).toContain('Already sent. Tell the admin.'); // B10: non admin/director get the F-35 rewrite
    const h2 = makeEnv({ post: (_p, b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'cancel', outcome: 'refused', code: 'LINK_NOT_YOURS', message: 'Only the leader who sent this can undo it.' }] }) });
    h2.fns._lkQSet([{ kind: 'cancel', id: P(41), leaderId: null }]);
    await h2.fns._lkFlush();
    expect(h2.calls.toasts).toContain('Only the leader who sent this can undo it.');
  });
  it('setMyLeaderId queues an identity item only when the value changes and the switch is on', () => {
    const h = makeEnv();
    h.fns.setMyLeaderId(P(8));
    h.fns.setMyLeaderId(P(8));
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'identity', from: null, to: P(8) });
    expect(Number.isNaN(Date.parse(q[0].at))).toBe(false);
    h.fns.setMyLeaderId(null);
    expect(h.fns._lkQGet()[1]).toMatchObject({ kind: 'identity', from: P(8), to: null });
    const off = makeEnv({ mode: 'off' });
    off.fns.setMyLeaderId(P(8));
    expect(off.fns._lkQGet()).toEqual([]);
    expect(off.env.storage.get('yap_leader_id')).toBe(P(8));
  });
  it('_lkMerge: server rows win, except items still queued', () => {
    const h = makeEnv();
    const server = [
      { personId: P(1), name: 'A', checkedIn: false, action: null, mine: false },
      { personId: P(2), name: 'B', checkedIn: true, action: { id: P(60), type: 'checkIn', status: 'sent', reason: null }, mine: false },
      { personId: P(3), name: 'C', checkedIn: true, action: { id: P(61), type: 'checkIn', status: 'sent', reason: null }, mine: true },
    ];
    const queue = [
      { kind: 'action', id: P(70), type: 'checkIn', payload: { serviceTimeId: SVC.serviceTimeId, personId: P(1) } },
      { kind: 'action', id: P(71), type: 'checkIn', payload: { serviceTimeId: 'other', personId: P(2) } },
      { kind: 'undo', id: P(61), newId: P(72), _s: SVC.serviceTimeId, _p: P(3) },
    ];
    const m = h.fns._lkMerge(server, queue, SVC.serviceTimeId);
    expect(m[0]).toMatchObject({ checkedIn: true, queued: true, mine: true, action: { id: P(70), status: 'queued' } });
    expect(m[1]).toBe(server[1]);
    expect(m[2]).toMatchObject({ checkedIn: false, queued: true, action: { id: P(72), type: 'checkOut', status: 'queued' } });
  });
});

describe('B13 / T-37 the phone queue belongs to one login (APP-13, APP-33, APP-73)', () => {
  const item = (n: number) => ({ v: 1, kind: 'action', id: P(n), type: 'checkIn',
    payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, personId: P(1) }, note: null, leaderId: null });
  it('preview with a queued item: nothing is flushed under the previewed token; the admin queue stays', async () => {
    const h = makeEnv({ role: 'admin' });
    h.fns._lkQSet([item(1)]);
    const { S } = h.get();
    S.user = { id: 'u2', role: 'grade' }; // enterPreview swaps the token and the user, then resets LINK
    h.fns._lkSoftReset();
    await h.fns._lkFlush();
    expect(h.calls.posts).toHaveLength(0);
    S.user = { id: 'u1', role: 'admin' };
    h.fns._lkSoftReset();
    expect(h.fns._lkQGet()).toHaveLength(1);
    for (const f of ['enterPreview', 'exitPreview', '_handleAuthExpired']) {
      expect(extractFn(html, f)).toMatch(/API\.setToken\([^)]*\);[\s\S]*_lkSoftReset\(\);/);
    }
  });
  it('a flush in flight when the login changes is ignored (its queue is not touched)', async () => {
    let release!: (v: any) => void;
    const h = makeEnv({ post: (_p, b) => new Promise((r) => { release = () => r({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'saved' })) }); }) });
    h.fns._lkQSet([item(1)]);
    const f = h.fns._lkFlush();
    const { S } = h.get();
    S.user = { id: 'u2', role: 'grade' };
    h.fns._lkSoftReset();
    h.fns._lkQSet([item(2)]);
    release(null);
    await f;
    expect(h.fns._lkQGet().map((x: any) => x.id)).toEqual([P(2)]);
    S.user = { id: 'u1', role: 'grade' };
    expect(h.fns._lkQGet().map((x: any) => x.id)).toEqual([P(1)]); // replays next time: nothing lost
  });
  it('a quota error removes the stored key and keeps the queue in memory for that login only', () => {
    const h = makeEnv();
    h.fns._lkQSet([item(1)]);
    h.env.quota = true;
    h.fns._lkQSet([item(1), item(2)]);
    expect(h.env.storage.has('ysc.lkq.u1')).toBe(false);
    expect(h.fns._lkQGet()).toHaveLength(2);
    h.get().S.user = { id: 'u2', role: 'grade' };
    expect(h.fns._lkQGet()).toHaveLength(0);
  });
  it('a stored queue is stamped; on login, other logins older than 3 days are dropped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T09:00:00.000Z'));
    const h = makeEnv();
    h.fns._lkQSet([item(1)]);
    expect(JSON.parse(h.env.storage.get('ysc.lkq.u1')!)).toEqual({ at: '2026-10-16T09:00:00.000Z', q: [item(1)] });
    h.env.storage.set('ysc.lkq.u9', JSON.stringify({ at: '2026-10-12T08:00:00.000Z', q: [item(9)] }));
    h.env.storage.set('ysc.lkq.u8', JSON.stringify({ at: '2026-10-14T08:00:00.000Z', q: [item(8)] }));
    h.env.storage.set('ysc.lkq.u7', JSON.stringify([item(7)])); // an old bare array with no stamp: kept
    h.fns._lkBoot();
    expect([...h.env.storage.keys()].filter((k) => k.startsWith('ysc.lkq.')).sort()).toEqual(['ysc.lkq.u1', 'ysc.lkq.u7', 'ysc.lkq.u8']);
  });
  it('the comment no longer claims minors names never reach localStorage', () => {
    expect(html).not.toContain('kept in memory only, never in localStorage');
  });
});

describe('B15 / T-45 a stale refresh (APP-23)', () => {
  it('an older refresh reply that lands after a confirmed tap does not revert it; a later load is kept', async () => {
    const replies: ((v: any) => void)[] = [];
    const h = makeEnv({
      fresh: () => new Promise((r) => { replies.push(r); }),
      post: (_p, b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'saved', mine: true,
        action: { id: b.items[0].id, type: 'checkIn', status: 'pending', reason: null } }] }) });
    door(h, [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    const before = h.fns._lkLoadPeople(SVC.serviceTimeId); // the 60 s refresh starts before the tap
    h.fns._lkCheck(P(1), 'checkIn');
    await h.fns._lkFlush();
    const row = () => h.get().LINK.people[SVC.serviceTimeId].people[0];
    expect(row()).toMatchObject({ checkedIn: true, action: { status: 'pending' } });
    replies[0]!({ people: [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: false, action: null, mine: false }], leaders: [] });
    expect(await before).toBe(false);
    expect(row()).toMatchObject({ checkedIn: true, action: { status: 'pending' } });
    const after = h.fns._lkLoadPeople(SVC.serviceTimeId);
    replies[1]!({ people: [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: true,
      action: { id: P(5), type: 'checkIn', status: 'sent', reason: null }, mine: true }], leaders: [] });
    expect(await after).toBe(true);
    expect(row()).toMatchObject({ action: { status: 'sent' } });
  });
});

describe('F1.2 logout guard', () => {
  const item = { kind: 'action', id: P(80), type: 'checkIn', payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, personId: P(1) }, note: null, leaderId: null };
  it('no unsent items: no question', async () => {
    const h = makeEnv();
    expect(await h.fns._lkLogoutGuard()).toBe(true);
    expect(h.calls.asks).toEqual([]);
  });
  it('asks first, sends, and logs out when the send works', async () => {
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'saved' })) }) });
    h.fns._lkQSet([item]);
    h.answers.push(true);
    expect(await h.fns._lkLogoutGuard()).toBe(true);
    expect(h.calls.asks[0]).toBe('1 action is waiting to send. Send it now? | Send now | Stay');
    expect(h.calls.posts).toHaveLength(1);
  });
  it('Stay keeps the login', async () => {
    const h = makeEnv();
    h.fns._lkQSet([item]);
    h.answers.push(false);
    expect(await h.fns._lkLogoutGuard()).toBe(false);
    expect(h.calls.posts).toHaveLength(0);
  });
  it('B14: a send that does not finish within 10 s offers "Log out anyway (they may not be sent)"', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: () => new Promise(() => {}) });
    h.fns._lkQSet([item, item]);
    h.answers.push(true, true);
    const p = h.fns._lkLogoutGuard();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBe(true);
    expect(h.calls.asks[0]).toMatch(/^2 actions are waiting to send/);
    expect(h.calls.asks[1]).toBe('2 actions are still waiting to send. | Log out anyway (they may not be sent) | Stay');
  });
  it('B14 / APP-22: 160 queued items drain in under 2 s on a good network (300 ms between batches)', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'saved' })) }) });
    h.fns._lkQSet(Array.from({ length: 160 }, (_, i) => ({ ...item, id: P(1000 + i) })));
    h.fns._lkFlush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fns._lkQGet()).toHaveLength(0);
    expect(h.calls.posts).toHaveLength(4);
  });
  it('B14: rate-limited leftovers wait 15 s, not 300 ms', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'refused', code: 'RATE_LIMITED' })) }) });
    h.fns._lkQSet([item]);
    await h.fns._lkFlush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.calls.posts).toHaveLength(1);
  });
  it('B14: the logout guard keeps flushing until the queue is empty (more than one batch)', async () => {
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'saved' })) }) });
    h.fns._lkQSet(Array.from({ length: 120 }, (_, i) => ({ ...item, id: P(2000 + i) })));
    h.answers.push(true);
    expect(await h.fns._lkLogoutGuard()).toBe(true);
    expect(h.calls.asks).toHaveLength(1);
    expect(h.fns._lkQGet()).toHaveLength(0);
  });
  it('B14 / APP-34: an identity-only queue gets one silent flush before it is cleared; no question', async () => {
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: 'logged' })) }) });
    h.fns._lkQSet([{ v: 1, kind: 'identity', id: P(3000), at: '2026-10-16T09:00:00.000Z', from: null, to: P(5) }]);
    expect(await h.fns._lkLogoutGuard()).toBe(true);
    expect(h.calls.asks).toEqual([]);
    expect(h.calls.posts).toHaveLength(1);
  });
  it('_lkClear drops the queue and LINK; doLogout runs the guard before anything is cleared', () => {
    const h = makeEnv();
    h.fns._lkQSet([item]);
    h.get().LINK.people.x = { people: [{ name: 'A' }] };
    h.fns._lkClear();
    expect(h.env.storage.has('ysc.lkq.u1')).toBe(false);
    const fresh = makeEnv({ storage: h.env.storage });
    expect(fresh.fns._lkQGet()).toEqual([]);
    const body = extractFn(html, 'doLogout');
    expect(body.indexOf('_lkLogoutGuard')).toBeGreaterThan(-1);
    expect(body.indexOf('_lkLogoutGuard')).toBeLessThan(body.indexOf('_lkClear'));
    expect(body.indexOf('_lkClear')).toBeLessThan(body.indexOf('S.user = null'));
  });
});

// ── F1.3 the door screen ──
describe('F1.3 door', () => {
  const people = [
    { personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, action: null, mine: false },
    { personId: P(2), name: 'Dana Testleader', grade: null, leader: true, checkedIn: false, action: null, mine: false },
    { personId: P(3), name: 'Ben <b>Sample</b>', grade: 9, leader: false, checkedIn: true, action: { id: P(30), type: 'checkIn', status: 'pending', reason: null }, mine: true },
    { personId: P(4), name: 'Gus Notreal', grade: 11, leader: false, checkedIn: true, action: { id: P(31), type: 'checkIn', status: 'shadowed', reason: null }, mine: false },
    { personId: P(5), name: 'Hana Invented', grade: 7, leader: false, checkedIn: true, action: null, mine: false },
    { personId: P(6), name: 'Mary Jane Smith', grade: 10, leader: false, checkedIn: false, action: null, mine: false },
  ];
  const setup = () => { const h = makeEnv(); door(h, JSON.parse(JSON.stringify(people))); return h; };
  it('rows have no gender word, gender class or gender colour', () => {
    const h = setup();
    const out = h.fns._lkListHtml();
    expect(out).not.toMatch(/gender|girl|boy|female|male|genderF|genderM|acct-|#ec4899|#3b82f6|--girl|--boy/i);
  });
  it('a leader row shows the "Leader" chip; a student row its grade chip (neutral)', () => {
    const h = setup();
    expect(h.fns._lkRowHtml(people[1])).toContain('<span class="lk-chip lead">Leader</span>');
    expect(h.fns._lkRowHtml(people[0])).toContain('<span class="lk-chip">Yr 7</span>');
    expect(html).toMatch(/\.lk-chip\{[^}]*background:var\(--chip\)/);
  });
  it('search matches words in any order', () => {
    const f = makeEnv().fns._lkFilter;
    expect(f(people, { search: 'smith mary', grade: 'all' }).map((p: any) => p.personId)).toEqual([P(6)]);
    expect(f(people, { search: 'JANE  smi', grade: 'all' })).toHaveLength(1);
    expect(f(people, { search: 'ava zed', grade: 'all' })).toHaveLength(0);
  });
  it('RFIX: the door filter is the search only (the grade select is gone)', () => {
    const f = makeEnv().fns._lkFilter;
    expect(f(people, { search: '' })).toHaveLength(6);
    expect(f(people, { search: '', grade: '7' })).toHaveLength(6); // a stale grade key does nothing
    expect(extractFn(html, '_lkFilter')).not.toContain('grade');
    expect(extractFn(html, '_lkFresh')).not.toContain("grade: 'all'");
  });
  it('T7: the door has a big search bar and no grade select; the leaders button comes after the list', () => {
    const f = extractFn(html, '_lkPaintDoor');
    expect(f).toContain('<div class="sbar"><input class="lk-big" id="lk-search"'); // UI standard D: the shared search bar
    expect(f).not.toContain('<select');
    expect(f.indexOf('id="lk-list"')).toBeLessThan(f.indexOf('_lkOpenLeaders()'));
    expect(f.indexOf('id="lk-search"')).toBeLessThan(f.indexOf('id="lk-list"'));
  });
  it('T7: nothing is listed until a name is typed; "In N" and "Still to come" are gone', () => {
    const h = setup();
    const out = h.fns._lkListHtml();
    expect(strip(out)).toContain('Type a name to check someone in.');
    expect(strip(out)).toContain('Checked in · 3');
    for (const nm of ['Ava Example', 'Mary Jane Smith', 'Dana Testleader']) expect(out).not.toContain(nm);
    expect(strip(out)).not.toMatch(/\bIn \d|Still to come/);
    h.get().LINK.q.search = 'mary';
    const typed = h.fns._lkListHtml();
    expect(typed).toContain('Mary Jane Smith');
    expect(typed).not.toContain('Ava Example');
    expect(strip(typed)).toContain('Checked in · 3'); // R2-G6: the count is the whole service, typed or not
    h.get().LINK.q.search = 'zzz';
    expect(strip(h.fns._lkListHtml())).toContain('Nobody here by that name.');
  });
  it('R2-G6: a name search lists people already checked in, with their status and Check out', () => {
    const h = setup();
    h.get().LINK.q.search = 'hana';
    const out = h.fns._lkListHtml();
    const due = strip(out.slice(0, out.indexOf('class="lk-done"')));
    expect(due).toContain('Hana Invented');
    expect(due).toContain('In Elvanto.');
    expect(due).toContain('Check out');
    expect(strip(out)).not.toContain('Nobody here by that name.');
    expect(strip(out)).toContain('Checked in · 3');
    h.get().LINK.q.search = 'zzz';
    expect(strip(h.fns._lkListHtml())).toContain('Nobody here by that name.');
  });
  it('R2-G1 G0: "Kiosk check-ins as of h:mm" from the services push; amber when over 10 min old on the service day', () => {
    const h = setup();
    const at = (minAgo: number) => ({ mirrors: { services: { takenAt: new Date(Date.now() - minAgo * 60000).toISOString(), ageSeconds: minAgo * 60 } } });
    expect(strip(h.fns._lkListHtml())).not.toContain('Kiosk check-ins');
    h.get().LINK.status = at(3);
    const fresh = h.fns._lkListHtml();
    expect(strip(fresh)).toContain('Kiosk check-ins as of ' + h.fns._lkTime(h.get().LINK.status.mirrors.services.takenAt));
    expect(fresh).not.toContain('c-warn');
    h.get().LINK.status = at(15);
    const old = h.fns._lkListHtml();
    expect(old).toContain('c-warn');
    expect(old).toContain('data-ic="alert"');
    h.get().LINK.services[0].ymd = '2026-01-02'; // a past service picked on purpose: no warning
    expect(h.fns._lkListHtml()).not.toContain('c-warn');
    h.get().LINK.status = { mirrors: { services: { takenAt: null, ageSeconds: null } } };
    expect(strip(h.fns._lkListHtml())).not.toContain('Kiosk check-ins');
  });
  it('T3: a checked-in person with no grade (not on the roster) still shows as a named row; a nameless one is labelled', () => {
    const h = makeEnv();
    door(h, [{ personId: P(7), name: 'Pia Pushedname', grade: null, leader: false, checkedIn: true, action: null, mine: false },
      { personId: P(8), name: '', grade: null, leader: false, checkedIn: true, action: null, mine: false }]);
    h.fns._lkDoneToggle(true);
    const out = h.fns._lkListHtml();
    expect(out).toContain('Pia Pushedname');
    expect(strip(out)).toContain('Checked in · 2');
    expect(strip(out)).toContain('Unknown person');
  });
  it('APP-74 / R2-G6: Checked in starts closed with the 3 most recent rows and Show all N; no more rows are built while closed', () => {
    expect(extractFn(html, '_lkFresh')).toContain('doneOpen: false');
    const h = makeEnv();
    const ci = (n: number, name: string) => ({ personId: P(n), name, grade: 9, leader: false, checkedIn: true, action: null, mine: false });
    door(h, [ci(1, 'Ava One'), ci(2, 'Ben Two'), ci(3, 'Cal Three'), ci(4, 'Dee Four'), ci(5, 'Eli Five')]);
    h.get().LINK.seenAt = { [SVC.serviceTimeId]: { [P(1)]: 0, [P(2)]: 0, [P(3)]: 300, [P(4)]: 100, [P(5)]: 200 } };
    const closed = h.fns._lkListHtml();
    expect(strip(closed)).toContain('Checked in · 5');
    expect(strip(closed)).toContain('Show all 5');
    expect((closed.match(/class="li lk-row"/g) ?? []).length).toBe(3);
    const t = strip(closed);
    expect(t.indexOf('Cal Three')).toBeLessThan(t.indexOf('Eli Five'));
    expect(t.indexOf('Eli Five')).toBeLessThan(t.indexOf('Dee Four'));
    for (const nm of ['Ava One', 'Ben Two']) expect(closed).not.toContain(nm);
    h.fns._lkDoneToggle(true);
    expect(h.get().LINK.doneOpen).toBe(true);
    const open = h.fns._lkListHtml();
    for (const nm of ['Ava One', 'Ben Two', 'Cal Three', 'Dee Four', 'Eli Five']) expect(open).toContain(nm);
    expect(strip(open)).toContain('Show fewer');
    expect(strip(open).indexOf('Ava One')).toBeLessThan(strip(open).indexOf('Ben Two')); // first seen together: by name
    expect(h.fns._lkDoneRowsHtml()).toContain('Ava One');
    h.fns._lkDoneToggle(false);
    expect((h.fns._lkListHtml().match(/class="li lk-row"/g) ?? []).length).toBe(3);
  });
  it('R2-G6: the first list this phone sees counts as earlier; a later check-in goes to the top; 3 or fewer need no Show all', () => {
    const h = makeEnv();
    const ci = (n: number, name: string, inn = true) => ({ personId: P(n), name, grade: 9, leader: false, checkedIn: inn, action: null, mine: false });
    door(h, [ci(1, 'Ava One'), ci(2, 'Ben Two'), ci(3, 'Zed Late', false)]);
    const first = h.fns._lkListHtml();
    expect(strip(first)).not.toContain('Show all');
    expect(h.get().LINK.seenAt[SVC.serviceTimeId]).toEqual({ [P(1)]: 0, [P(2)]: 0 });
    h.get().LINK.people[SVC.serviceTimeId].people[2].checkedIn = true;
    const t = strip(h.fns._lkListHtml());
    expect(t.indexOf('Zed Late')).toBeLessThan(t.indexOf('Ava One'));
    h.get().LINK.people[SVC.serviceTimeId].people[2].checkedIn = false; // checked out: forgotten
    h.fns._lkListHtml();
    expect(h.get().LINK.seenAt[SVC.serviceTimeId][P(3)]).toBeUndefined();
  });
  it('R2-G6: waking the phone and coming back to Check-in both reload the door list', () => {
    const at = html.search(/document\.addEventListener\('visibilitychange', \(\) => \{\r?\n    if \(document\.visibilityState === 'hidden'\) \{ _lkTickStop\(\); return; \}/);
    expect(at).toBeGreaterThan(0);
    const wake = html.slice(at, html.indexOf('} catch (e) {}', at));
    expect(wake).toContain("S.page === 'link-checkin'");
    expect(wake).toContain('_lkLoadPeople(LINK.svc, true)');
    const r = extractFn(html, 'renderLinkCheckin');
    expect(r).toContain('if (cached)');
    expect(r).toContain('_lkLoadPeople(svc, true)');
  });
  it('APP-74: search repaints after an 80 ms pause; the filter value is kept at once', () => {
    const h = setup();
    h.fns._lkSetSearch('ava');
    expect(h.get().LINK.q.search).toBe('ava');
    expect(extractFn(html, '_lkSetSearch')).toMatch(/setTimeout\([^]*, 80\)/);
  });
  it('APP-75: background link calls are quiet (no loading bar): the flush, the status and the 60 s refresh', () => {
    expect(html).toMatch(/async function r\(method, path, body, timeoutMs, quiet, keepalive\) \{\r?\n    if \(!quiet\) _npStart\(\);/);
    expect(html).toMatch(/if \(!quiet\) _npDone\(\);/);
    expect(html).toContain("post: (p, b, timeoutMs, quiet, keepalive) => r('POST', p, b, timeoutMs, quiet, keepalive),");
    expect(extractFn(html, '_lkFlush')).toContain('20000, true)');
    expect(extractFn(html, '_lkStatusLoad')).toContain("API.fresh('/link/status', true)");
    const tick = extractFn(html, '_lkTick');
    for (const c of ['_lkLoadPeople(LINK.svc, true)', '_lkLoadGroups(true)', '_lkLoadFlows(true)']) expect(tick).toContain(c);
  });
  it('APP-21: the admin Today card makes one /link/actions call for the day (plus CY-A1 unclear rows), not one per type', () => {
    const f = extractFn(html, '_lkAdmLoadActs');
    expect(f.match(/API\.fresh\(/g)).toHaveLength(2);
    expect(f).toContain("API.fresh('/link/actions?status=unclear')");
    expect(f).toContain("API.fresh('/link/actions?serviceDate=' + today)");
    expect(f).not.toContain('&type=');
  });
  it('APP-44: no 15 s poll of my open rows; the 60 s refresh carries the statuses', () => {
    expect(html).not.toContain('function _lkPollOpen');
    expect(extractFn(html, '_lkTickStart')).toContain('setInterval(_lkTick, 60000)');
    expect(extractFn(html, '_lkTick')).not.toContain('% 4');
  });
  it('a row whose newest action is mine shows Undo; others show Check in / Check out', () => {
    const h = setup();
    expect(strip(h.fns._lkRowHtml(people[2]))).toContain('Undo');
    expect(strip(h.fns._lkRowHtml(people[2]))).toContain('Check out'); // B6: every checked-in row
    expect(strip(h.fns._lkRowHtml(people[4]))).toContain('Check out');
    expect(strip(h.fns._lkRowHtml(people[0]))).toContain('Check in');
    h.fns._lkCheck(P(1), 'checkIn');
    const merged = h.fns._lkMerge(h.get().LINK.people[SVC.serviceTimeId].people, h.fns._lkQGet(), SVC.serviceTimeId);
    const row = strip(h.fns._lkRowHtml(merged[0]));
    expect(row).toContain('Undo');
    expect(row).toContain('Waiting to send.');
  });
  it('B6 / T-30: Undo only while queued or pending; a sent check-in (mine) shows Check out only', () => {
    const h = setup();
    const sent = { ...people[2], action: { id: P(30), type: 'checkIn', status: 'sent', reason: null, resultAt: '2026-10-16T09:02:00.000Z' } };
    const row = strip(h.fns._lkRowHtml(sent));
    expect(row).not.toContain('Undo');
    expect(row).toContain('Check out');
    const claimed = strip(h.fns._lkRowHtml({ ...people[2]!, action: { ...people[2]!.action, status: 'claimed' } }));
    expect(claimed).not.toContain('Undo');
    expect(claimed).toContain('Check out');
    h.fns._lkCheck(P(1), 'checkIn');
    const merged = h.fns._lkMerge(h.get().LINK.people[SVC.serviceTimeId].people, h.fns._lkQGet(), SVC.serviceTimeId);
    const q = strip(h.fns._lkRowHtml(merged[0]));
    expect(q).toContain('Undo');
    expect(q).not.toContain('Check out'); // queued: Undo removes it here
  });
  it('B6 / APP-50: a duplicate answer is not mine (no Undo offered)', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: (_p, b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'duplicate',
      existingId: P(77), mine: false, action: { id: P(77), type: 'checkIn', status: 'pending', reason: null } }] }) });
    door(h, [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkIn');
    await h.fns._lkFlush();
    const p = h.get().LINK.people[SVC.serviceTimeId].people[0];
    expect(p).toMatchObject({ checkedIn: true, mine: false, action: { id: P(77) } });
    expect(strip(h.fns._lkRowHtml(p))).not.toContain('Undo');
  });
  it('a kiosk check-in reads "In Elvanto."', () => {
    const h = setup();
    expect(strip(h.fns._lkRowHtml(people[4]))).toContain('In Elvanto.');
  });
  it('every name passes through esc()', () => {
    const h = setup();
    const row = h.fns._lkRowHtml(people[2]);
    expect(row).toContain('Ben &lt;b&gt;Sample&lt;/b&gt;');
    expect(row).not.toContain('<b>Sample');
  });
  it('the service line and the door list stay out of localStorage', () => {
    const h = setup();
    h.fns._lkCheck(P(1), 'checkIn');
    expect([...h.env.storage.values()].join('')).not.toContain('Ava');
    expect(h.fns._lkSvcLabel(SVC)).toBe('Fri 16 Oct · Youth 6:30 pm');
  });
});

describe('B10 / T-33 the tap toast (APP-9)', () => {
  it('a check-in tap shows "Checked in <name> · Undo" for 5 s; its Undo removes the queued item here', () => {
    vi.useFakeTimers();
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava <b>E</b>', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkIn');
    const t = h.get().LINK.toast;
    expect(t.html).toContain('Checked in Ava &lt;b&gt;E&lt;/b&gt; · ');
    expect(t.html).toContain('>Undo</button>');
    expect(h.fns._lkQGet()).toHaveLength(1);
    h.fns._lkToastUndo();
    expect(h.fns._lkQGet()).toHaveLength(0);
    expect(h.get().LINK.toast).toBeNull();
    h.fns._lkCheck(P(1), 'checkIn');
    vi.advanceTimersByTime(5001);
    expect(h.get().LINK.toast).toBeNull();
    h.fns._lkToastUndo(); // too late: nothing happens
    expect(h.fns._lkQGet()).toHaveLength(1);
  });
  it('a check-out tap shows no toast', () => {
    vi.useFakeTimers();
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: true, action: null, mine: false }]);
    h.fns._lkCheck(P(1), 'checkOut');
    expect(h.get().LINK.toast).toBeNull();
  });
});

describe('B9 / T-32 wrong service (D3)', () => {
  const THU = { ...SVC, serviceTimeId: P(901), serviceId: P(902), name: 'Midweek', startsAt: '2026-10-15T08:30:00.000Z', ymd: '2026-10-15' };
  const setupDay = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava', grade: 7, leader: false, checkedIn: false, action: null, mine: false }]);
    h.fns._lkTakeServices({ today: '2026-10-16', services: [SVC, THU], defaultServiceTimeId: SVC.serviceTimeId });
    h.get().LINK.okDay = {};
    return h;
  };
  it('the service day is the Brisbane day, the previous day before 03:00', () => {
    expect(setupDay('2026-10-16T09:00:00.000Z').fns._lkSvcDay()).toBe('2026-10-16');
    expect(setupDay('2026-10-16T14:30:00.000Z').fns._lkSvcDay()).toBe('2026-10-16'); // Sat 00:30
    expect(setupDay('2026-10-16T17:00:00.000Z').fns._lkSvcDay()).toBe('2026-10-17');
  });
  it('an amber "Not today" chip on any other day, in the pick sheet and on the door line; none at 00:30 Saturday for Friday', () => {
    const h = setupDay('2026-10-16T14:30:00.000Z');
    h.get().LINK.pickSel = SVC.serviceTimeId;
    const opts = h.fns._lkPickHtml().split('lk-opt').slice(1);
    const fri = opts.find((o: string) => o.includes('Youth'))!, thu = opts.find((o: string) => o.includes('Midweek'))!;
    expect(fri).not.toContain('Not today');
    expect(thu).toContain('<span class="lk-tag amber">Not today</span>');
    expect(h.fns._lkNotToday(THU)).toContain('Not today');
    expect(h.fns._lkNotToday(SVC)).toBe('');
    expect(html).toContain("${s ? esc(_lkSvcLabel(s)) : 'Pick a service'}${s ? _lkNotToday(s) : ''}");
  });
  it('T9: checking in to a service that is not today asks nothing', () => {
    const h = setupDay('2026-10-17T09:00:00.000Z'); // Saturday evening: Friday is not today
    h.fns._lkCheck(P(1), 'checkIn');
    expect(h.calls.asks).toHaveLength(0);
    expect(h.fns._lkQGet()).toHaveLength(1);
  });
  it('a pick made on day 1 and opened on day 8 drops the services, default, pick and people, and keeps the queue', () => {
    const h = setupDay('2026-10-16T09:00:00.000Z');
    h.fns._lkCheck(P(1), 'checkIn');
    expect(h.fns._lkDayCheck()).toBe(false);
    vi.setSystemTime(new Date('2026-10-23T09:00:00.000Z'));
    expect(h.fns._lkDayCheck()).toBe(true);
    const L = h.get().LINK;
    expect(L).toMatchObject({ services: null, defaultSvc: null, svc: null, people: {} });
    expect(h.fns._lkQGet()).toHaveLength(1);
    expect(html).toMatch(/async function renderLinkCheckin\(\) \{\r?\n  _lkDayCheck\(\);/);
    expect(html).toMatch(/if \(_lkOnPage\(\)\) \{\r?\n\s*if \(_lkDayCheck\(\) && S\.page === 'link-checkin'\) renderLinkCheckin\(\);/);
  });
  it('no service today: "Tonight\u2019s service is not here yet" line (kiosk)', () => {
    const h = setupDay('2026-10-17T09:00:00.000Z');
    expect(h.get().LINK.svc).toBe(SVC.serviceTimeId); // a past service is selected: no banner (T9)
    expect(h.fns._lkNoTonight()).toBe('');
    h.get().LINK.svc = null;
    expect(strip(h.fns._lkNoTonight())).toContain("Tonight's service isn't here yet. Use the kiosk.");
    const h2 = setupDay('2026-10-16T09:00:00.000Z');
    expect(h2.fns._lkNoTonight()).toBe('');
  });
});

// ── F1.4 leader quick check-in ──
describe('F1.4 leader sheet', () => {
  const leaders = [
    { leaderId: 'l3', name: 'Cal <i>Exampleleader</i>', personId: P(13), checkedIn: false, action: null, mine: false },
    { leaderId: 'l1', name: 'Alex Testleader', personId: P(11), checkedIn: false, action: null, mine: false },
    { leaderId: 'l2', name: 'Bea Sampleleader', personId: P(12), checkedIn: true, action: { id: P(90), type: 'checkIn', status: 'sent', reason: null }, mine: false },
    { leaderId: 'l5', name: 'Eve Mockleader', personId: null, checkedIn: false, action: null, mine: false },
  ];
  const setup = () => { const h = makeEnv({ leaderId: P(77) }); door(h, [], JSON.parse(JSON.stringify(leaders))); h.get().LINK.lq = {}; return h; };
  const rowsOf = (h: any) => h.fns._lkLeadersHtml().split('lk-lq-row').slice(1);
  it('B11 / APP-56: one line when there are unlinked leaders; none when all are linked', () => {
    const h = setup();
    expect(strip(h.fns._lkLeadersHtml())).toContain('Not linked: not found in Elvanto by this exact name (or more than one match). Ask the admin to fix the name.');
    const h2 = makeEnv(); door(h2, [], [leaders[1]]); h2.get().LINK.lq = {};
    expect(strip(h2.fns._lkLeadersHtml())).not.toContain('Not linked:');
  });
  it('B11 / APP-56: the sheet opens with "Loading…" until the leader list is loaded; Submit stays disabled', () => {
    const h = makeEnv();
    door(h);
    delete h.get().LINK.people[SVC.serviceTimeId];
    h.fns._lkOpenLeaders();
    expect(h.calls.modals).toHaveLength(1);
    expect(h.calls.modals[0]!).toContain('role="progressbar"'); // S5: a bar, not "Loading…"
    expect(h.calls.modals[0]).toMatch(/id="lk-lq-go" disabled/);
  });
  it('lists leaders A–Z, name only', () => {
    const h = setup();
    const names = rowsOf(h).map((r: string) => strip('<' + r).trim());
    expect(names[0]).toMatch(/^Alex Testleader/);
    expect(names[1]).toMatch(/^Bea Sampleleader/);
    expect(names[2]).toMatch(/^Cal/);
    expect(names[3]).toMatch(/^Eve Mockleader/);
    expect(h.fns._lkLeadersHtml()).not.toMatch(/Yr \d|gender|girl|boy/i);
  });
  it('checked in = Done (no box); no personId = greyed Not linked (no box); the rest get a box', () => {
    const r = rowsOf(setup());
    expect(r[1]).toContain('lk-done-ic'); expect(r[1]).not.toContain('lk-box'); expect(strip('<' + r[1])).toContain('In Elvanto'); expect(r[1]).toContain('data-ic="check"');
    expect(r[3]).toContain(' dis"'); expect(r[3]).toContain('Not linked'); expect(r[3]).not.toContain('class="lk-box"');
    expect(r[0]).toContain('class="lk-box"'); expect(r[2]).toContain('class="lk-box"');
  });
  it('Tick all ticks only tickable rows and flips to Untick all', () => {
    const h = setup();
    expect(h.fns._lkLeadersHtml()).toContain('>Tick all<');
    h.fns._lkTickAll();
    expect(h.get().LINK.lq).toEqual({ l1: true, l3: true });
    expect(h.fns._lkLeadersHtml()).toContain('>Untick all<');
    h.fns._lkTickAll();
    expect(h.get().LINK.lq).toEqual({});
  });
  it('Submit shows the ticked count and is disabled at 0', () => {
    const h = setup();
    expect(h.fns._lkLeadersFoot()).toMatch(/id="lk-lq-go" disabled[^>]*>Submit \(0\)</);
    h.fns._lkTickLeader('l1');
    expect(h.fns._lkLeadersFoot()).toMatch(/id="lk-lq-go" onclick="_lkLeadersSubmit\(\)">Submit \(1\)</);
    expect(html).toMatch(/\.mo-box > \.bus-sheet-actions\{position:sticky/);
  });
  it('Submit queues exactly one checkIn per ticked leader and nothing else; they show as Done at once', () => {
    vi.useFakeTimers();
    const h = setup();
    h.fns._lkTickAll();
    h.fns._lkLeadersSubmit();
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(2);
    for (const it of q) {
      expect(Object.keys(it).sort()).toEqual(['_at', 'id', 'kind', 'leaderId', 'note', 'payload', 'type', 'v']);
      expect(it).toMatchObject({ kind: 'action', type: 'checkIn', note: null, leaderId: P(77) });
      expect(Object.keys(it.payload).sort()).toEqual(['personId', 'serviceId', 'serviceTimeId']);
    }
    expect(q.map((i: any) => i.payload.personId).sort()).toEqual([P(11), P(13)]);
    expect(h.calls.closed).toBe(1);
    const states = h.fns._lkLeadersView().map((l: any) => h.fns._lkLeaderState(l));
    expect(states).toEqual(['done', 'done', 'done', 'nl']);
  });
  it('every name passes through esc()', () => {
    const out = setup().fns._lkLeadersHtml();
    expect(out).toContain('Cal &lt;i&gt;Exampleleader&lt;/i&gt;');
    expect(out).not.toContain('<i>Exampleleader');
  });
  it('the sheet opens the Pick a service sheet first when no service is chosen', () => {
    const h = setup();
    h.get().LINK.svc = null;
    h.fns._lkOpenLeaders();
    expect(h.calls.modals).toHaveLength(1);
    expect(h.calls.modals[0]).toContain('Pick a service');
    expect(h.get().LINK.pickThen).toBe('leaders');
  });
});

// ── Orchestrator fixes to F1 ──
describe('F1 fix: no Unicode symbols in the LINK block', () => {
  it('no arrow or tick glyphs; the sent tick is the SVG check icon', () => {
    const block = html.slice(html.indexOf('/* ── LINK MODULE ──'), html.indexOf('/* ── END LINK MODULE ── */'));
    expect(block).not.toMatch(/[←-⇿☀-➿]/);
    const h = makeEnv();
    expect(h.fns._lkStatusHtml({ status: 'sent', reason: 'already' })).toBe('<svg data-ic="check"></svg> Already in Elvanto');
    expect(h.fns._lkStatusHtml({ status: 'pending', reason: null })).toBe('Waiting for Elvanto.');
    expect(h.fns._lkStatusHtml({ status: 'refused', reason: 'report-exists' })).toBe('There&#39;s already a report for that date. Edit it.');
  });
});

describe('F1 fix: "I am" switch guard (ledger 18)', () => {
  const act = (n: number) => ({ kind: 'action', id: P(n), type: 'checkIn', payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, personId: P(n + 100) }, note: null, leaderId: 'L1' });
  const saved = (b: any) => Promise.resolve({ results: b.items.map((i: any) => ({ id: i.id, kind: i.kind, outcome: i.kind === 'identity' ? 'logged' : 'saved' })) });
  it('unsent items: asks first, sends, then switches; the sent items keep their own "I am"', async () => {
    let atPost: string | undefined = 'unset';
    const h: any = makeEnv({ leaderId: 'L1', post: (_p, b) => { atPost = h.env.storage.get('yap_leader_id'); return saved(b); } });
    h.fns._lkQSet([act(1), act(2), { kind: 'identity', id: P(9), at: '2026-10-16T08:00:00.000Z', from: null, to: 'L1' }]);
    h.answers.push(true);
    expect(await h.fns._lkSwitchLeader('L2')).toBe(true);
    expect(h.calls.asks).toEqual(['2 actions are still waiting to send. Send them first? | Send first | Cancel']);
    expect(h.calls.posts).toHaveLength(1);
    expect(atPost).toBeUndefined(); // the flush went out before the switch
    expect(h.calls.posts[0].b.items.filter((i: any) => i.kind === 'action').map((i: any) => i.leaderId)).toEqual(['L1', 'L1']);
    expect(h.env.storage.get('yap_leader_id')).toBe('L2');
  });
  it('one item reads in the singular; Cancel keeps the old "I am" and sends nothing', async () => {
    const h = makeEnv({ leaderId: 'L1' });
    h.fns._lkQSet([act(1)]);
    h.answers.push(false);
    expect(await h.fns._lkSwitchLeader(null)).toBe(false);
    expect(h.calls.asks).toEqual(['1 action is still waiting to send. Send it first? | Send first | Cancel']);
    expect(h.calls.posts).toHaveLength(0);
    expect(h.env.storage.has('yap_leader_id')).toBe(false);
    expect(h.fns._lkQGet()).toHaveLength(1);
  });
  it('no question with an empty queue (identity items do not count), with no "I am" yet, or for the same leader', async () => {
    const a = makeEnv({ leaderId: 'L1' });
    a.fns._lkQSet([{ kind: 'identity', id: P(9), at: 'x', from: null, to: 'L1' }]);
    expect(await a.fns._lkSwitchLeader('L2')).toBe(true);
    const b = makeEnv({ leaderId: null });
    b.fns._lkQSet([act(1)]);
    expect(await b.fns._lkSwitchLeader('L2')).toBe(true);
    const c = makeEnv({ leaderId: 'L1' });
    c.fns._lkQSet([act(1)]);
    expect(await c.fns._lkSwitchLeader('L1')).toBe(true);
    expect([...a.calls.asks, ...b.calls.asks, ...c.calls.asks]).toEqual([]);
    expect(b.env.storage.get('yap_leader_id')).toBe('L2');
  });
  it('a send that does not finish still switches after 10 s (nothing is lost: items keep their "I am")', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ leaderId: 'L1', post: () => new Promise(() => {}) });
    h.fns._lkQSet([act(1)]);
    h.answers.push(true);
    const p = h.fns._lkSwitchLeader('L2');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBe(true);
    expect(h.env.storage.get('yap_leader_id')).toBe('L2');
    expect(h.fns._lkQGet().filter((i: any) => i.kind === 'action')).toHaveLength(1);
  });
  it('every UI entry point changes "I am" through the guard; setMyLeaderId itself stays synchronous', () => {
    // setMyLeaderId is called only by _lkSwitchLeader and _busIdentityChanged (whose two handlers run the guard first),
    // plus the rework's three admin-preview resets (enter, exit, exit on a stale preview), which are not "I am" choices.
    expect(html.match(/setMyLeaderId\(/g)).toHaveLength(6);
    expect(html.match(/setMyLeaderId\(null\); _vgReset\(\);/g)).toHaveLength(3);
    expect(extractFn(html, '_lkSwitchLeader')).toContain('setMyLeaderId(');
    expect(extractFn(html, '_busIdentityChanged')).toContain('setMyLeaderId(');
    expect(html.match(/_busIdentityChanged\((this\.value|null)\)/g)).toHaveLength(2);
    expect(html).toContain('onclick="_lkSwitchGuard(null).then((ok) => { if (ok) _busIdentityChanged(null); })"');
    expect(html).toContain(`onchange="_lkSwitchGuard(this.value || null).then((ok) => { if (ok) _busIdentityChanged(this.value); else this.value = getMyLeaderId() || ''; })"`);
    expect(extractFn(html, 'setMyLeaderId')).not.toMatch(/async|await/);
    for (const fn of ['_homeNotYou', 'chooseHomeLeader', '_msNotYou', '_msPickLeader', '_lkIamUse']) {
      expect(extractFn(html, fn)).toContain('_lkSwitchLeader(');
    }
    expect(html).toContain('onclick="_homeNotYou()">Not you?</button>');
    expect(html).toContain('onclick="_msNotYou()">Not you?</button>');
    expect(html).toContain('onchange="_msPickLeader(this.value)"');
  });
});

// ── F2 lifegroup report ──
describe('F2 lifegroup report', () => {
  const G = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const RSVC = [
    { serviceTimeId: P(50), serviceId: P(51), name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16', isDefault: true },
    { serviceTimeId: P(52), serviceId: P(53), name: 'Morning', startsAt: '2026-10-11T00:15:00.000Z', ymd: '2026-10-11', isDefault: true },
  ];
  const grp = (over: any = {}) => ({ groupId: G(1), name: 'Yr 9 <i>Girls</i>', meets: 'Tue 6:30 PM',
    members: [{ personId: P(61), name: 'Ava Example', leader: false }, { personId: P(62), name: 'Dana Testleader', leader: true },
      { personId: P(63), name: 'Ben <b>Sample</b>', leader: false }],
    thisWeek: 'reported', defaultDate: '2026-10-13', openAction: null,
    lastReport: { reportId: G(9), date: '2026-10-06', time: '18:30', didNotMeet: false, attendees: [P(61), P(62)], guests: 2,
      serviceTimeId: null, editable: true, blocked: null, notes: 'SECRET NOTE' }, ...over });
  const setup = (leaderId: string | null = 'L1', over: any = {}, post?: Env['post']) => {
    const h = makeEnv({ leaderId, post });
    const L = h.get().LINK;
    L.today = '2026-10-16'; L.services = RSVC; L.ldrs = [{ id: 'L1', fullName: 'Cody <b>Codeman</b>', active: true }];
    L.groups = [grp(over)]; L.gid = G(1);
    return h;
  };
  it('T8: the group list shows the last report line, no this-week chip, and names are escaped', () => {
    const h = setup();
    const list = h.fns._lkGroupsHtml();
    expect(strip(list)).toContain('Last report Tue 6 Oct · Attendance: 4');
    expect(list).not.toContain('lk-wk');
    expect(strip(list)).not.toMatch(/Reported|No report\b/);
    expect(list).toContain('Yr 9 &lt;i&gt;Girls&lt;/i&gt;');
    expect(list).not.toContain('<i>Girls');
    expect(strip(setup('L1', { lastReport: null }).fns._lkGroupsHtml())).toContain('No reports yet');
  });
  it('the report card never shows notes', () => {
    const h = setup();
    const out = strip(h.fns._lkReportHtml(h.get().LINK.groups[0], h.get().LINK.groups[0].lastReport));
    expect(out).not.toContain('SECRET');
    expect(out).toContain('Tue 6 Oct 18:30');
    expect(out).not.toContain('Service');
    expect(out).toContain('Guests2');
    expect(out).toContain('Students here (1)Ava Example');
    const dnm = setup('L1', { lastReport: { ...grp().lastReport, didNotMeet: true, attendees: [] } });
    expect(strip(dnm.fns._lkReportHtml(dnm.get().LINK.groups[0], dnm.get().LINK.groups[0].lastReport))).toContain('Group did not meet');
  });
  it('2026-10-14: who came is a collapsed <details>; two reports on one day both show, with Sent by and a warning', () => {
    const lr = grp().lastReport;
    const dup = { ...lr, reportId: G(8), attendees: [P(61)], guests: 0, by: 'Cody <b>Codeman</b>' };
    const h = setup('L1', { history: [lr, dup] });
    const g = h.get().LINK.groups[0];
    const one = h.fns._lkReportHtml(g, lr);
    expect(one).toMatch(/<details class="lk-here"><summary>Students here \(1\)<\/summary>/); // closed: no open attribute
    expect(one).not.toContain('Sent by'); // made in Elvanto: no sender
    const w = { start: '2026-10-05', end: '2026-10-11' };
    const body = h.fns._lkWeekBodyHtml(g, w);
    expect(body).toContain('2 reports were sent for the same day');
    expect(body).toContain(`_lkEditReport('${G(9)}')`);
    expect(body).toContain(`_lkEditReport('${G(8)}')`);
    expect(strip(body)).toContain('Sent byCody &lt;b&gt;Codeman&lt;/b&gt;');
    expect(strip(h.fns._lkWeekBodyHtml(setup().get().LINK.groups[0], w))).not.toContain('same day');
  });
  it('Edit is shown only when editable, else "Edit this report in Elvanto."', () => {
    const a = setup();
    const on = a.fns._lkReportHtml(a.get().LINK.groups[0], a.get().LINK.groups[0].lastReport);
    expect(on).toContain(`onclick="_lkEditReport('${G(9)}')"`);
    expect(on).not.toContain('Edit this report in Elvanto.');
    const b = setup('L1', { lastReport: { ...grp().lastReport, editable: false, blocked: 'multi-service' } });
    const off = b.fns._lkReportHtml(b.get().LINK.groups[0], b.get().LINK.groups[0].lastReport);
    expect(off).not.toContain('_lkEditReport');
    expect(off).toContain('Edit this report in Elvanto.');
  });
  it('"Group did not meet" clears and hides ticks and service', () => {
    vi.useFakeTimers();
    const h = setup();
    h.fns._lkNewReport();
    h.fns._lkRfTick(P(61)); h.fns._lkRfSvc(P(50));
    expect(h.fns._lkFormHtml()).toContain('Who was there');
    h.fns._lkRfDnm(true);
    const rf = h.get().LINK.rf;
    expect(rf.ticks).toEqual({}); expect(rf.svc).toBe('');
    const form = h.fns._lkFormHtml();
    expect(form).not.toContain('Who was there'); expect(form).not.toContain('_lkRfSvc'); expect(form).not.toContain('_lkRfTick');
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()[0].payload).toMatchObject({ didNotMeet: true, attendees: [], serviceTimeId: null });
  });
  it('T3: Add report sits under the week reports; a same-date report is blocked (F-03)', () => {
    const h = setup();
    const w = h.fns._lkWeeks('2026-10-16')[1]; // the week of the 6 Oct report
    const body = h.fns._lkWeekBodyHtml(h.get().LINK.groups[0], w);
    expect(body).toContain("_lkAddReport('" + w.start + "')");
    expect(body.indexOf('Add report')).toBeGreaterThan(body.indexOf('Report</div>'));
    h.fns._lkAddReport(w.start);
    const rf = h.get().LINK.rf;
    expect(rf.add).toBe(true);
    h.fns._lkRfDate('2026-10-06'); h.fns._lkRfSvc('none');
    const form = h.fns._lkFormHtml();
    expect(strip(form)).toContain("There's already a report for that date. Edit it.");
    expect(form).toMatch(/disabled onclick="_lkReportSend\(\)"/);
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()).toHaveLength(0);
  });
  it('T2: the report card has no Service row', () => {
    const h = setup();
    const r = h.get().LINK.groups[0].lastReport;
    const card = h.fns._lkReportHtml(h.get().LINK.groups[0], r);
    expect(strip(card)).toContain('Guests');
    expect(strip(card)).not.toContain('Service');
  });
  it('T1: grade chips filter the list, the choice is remembered, rows are tinted by gender', () => {
    const h = setup('L1', { grade: 9, gender: 'female' });
    const g2 = { ...h.get().LINK.groups[0], groupId: G(2), name: 'Yr 7 Boys', grade: 7, gender: 'male' };
    h.get().LINK.groups.push(g2);
    const all = h.fns._lkGroupsHtml();
    expect(all).toContain("_lkGrFilter('all')"); expect(all).toContain("_lkGrFilter('7')"); expect(all).toContain("_lkGrFilter('9')");
    expect(all).toContain('var(--girl-light)'); expect(all).toContain('var(--boy-light)');
    h.get().LINK.groups[0].grade = 9;
    h.fns._lkGrFilter('7'); // remembered in the (stub) localStorage and applied on the next draw
    const f7 = h.fns._lkGroupsHtml();
    expect(f7).toContain('Yr 7 Boys'); expect(f7).not.toContain('Yr 9 ');
  });
  it('a date equal to the last report date shows the message and queues nothing', () => {
    const h = setup();
    h.fns._lkNewReport();
    h.fns._lkRfDate('2026-10-06'); h.fns._lkRfSvc('none');
    const form = h.fns._lkFormHtml();
    expect(strip(form)).toContain("There's already a report for that date. Edit it.");
    expect(form).toMatch(/disabled onclick="_lkReportSend\(\)"/);
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()).toEqual([]);
  });
  it('the note counter stops at 1,800', () => {
    const h = setup();
    h.fns._lkNewReport();
    const el = { value: 'x'.repeat(2000) };
    h.fns._lkRfNote(el);
    expect(el.value).toHaveLength(1800);
    expect(h.get().LINK.rf.note).toHaveLength(1800);
    expect(h.fns._lkFormHtml()).toContain('1,800 / 1,800');
    expect(h.fns._lkFormHtml()).toContain('maxlength="1800"');
    expect(h.fns._lkNoteCount(5)).toBe('5 / 1,800');
  });
  it('no "I am": the picker opens first (for New report, Edit and Send)', () => {
    const h = setup(null);
    h.get().LINK.iamPick = new Set(['L1']);
    h.fns._lkNewReport();
    expect(h.get().LINK.rf).toBeNull();
    expect(h.calls.modals).toHaveLength(1);
    expect(h.calls.modals[0]).toContain('Who are you?');
    expect(h.calls.modals[0]).toContain('Cody &lt;b&gt;Codeman&lt;/b&gt;');
    expect(h.get().LINK.iamThen).toBeTypeOf('function');
    h.fns._lkEditReport(G(9));
    expect(h.calls.modals).toHaveLength(2);
    h.get().LINK.rf = { mode: 'submit', date: '2026-10-13', didNotMeet: true, ticks: {}, guests: 0, svc: '', note: '', priv: false };
    h.fns._lkReportSend();
    expect(h.calls.modals).toHaveLength(3);
    expect(h.fns._lkQGet()).toEqual([]);
  });
  it('a report goes into the shared queue as submitReport with the raw note (no prefix)', () => {
    vi.useFakeTimers();
    const h = setup();
    h.fns._lkNewReport();
    expect(h.get().LINK.rf).toMatchObject({ date: '2026-10-13', svc: 'none' }); // a new report defaults to No service
    h.get().LINK.rf.svc = '';
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()).toEqual([]);
    expect(strip(h.fns._lkFormHtml())).toContain('Pick a service, or pick No service.');
    h.fns._lkRfSvc(P(50)); h.fns._lkRfTick(P(61)); h.fns._lkRfGuests('150');
    h.fns._lkRfNote({ value: 'Great night' });
    h.fns._lkReportSend();
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(1);
    expect(Object.keys(q[0]).sort()).toEqual(['_at', 'id', 'kind', 'leaderId', 'note', 'payload', 'type', 'v']);
    expect(q[0]).toMatchObject({ kind: 'action', type: 'submitReport', note: 'Great night', leaderId: 'L1' });
    expect(q[0].payload).toEqual({ groupId: G(1), date: '2026-10-13', didNotMeet: false, attendees: [P(61)], guests: 99, notesPrivate: false, serviceTimeId: P(50) });
    expect(h.get().LINK.rf).toBeNull();
    expect(h.fns._lkGroupAct(h.get().LINK.groups[0]).status).toBe('queued');
    expect(strip(h.fns._lkGroupHtml(h.get().LINK.groups[0]))).toContain('Waiting to send.');
    h.fns._lkReportUndo();
    expect(h.fns._lkQGet()).toEqual([]);
    // a blank note is sent as null; "No service" as null
    h.fns._lkNewReport(); h.fns._lkRfSvc('none'); h.fns._lkRfNote({ value: '   ' }); h.fns._lkReportSend();
    expect(h.fns._lkQGet()[0]).toMatchObject({ note: null, payload: { serviceTimeId: null } });
  });
  it('an edit goes in as editReport with reportId and base; the date stays the saved one', () => {
    vi.useFakeTimers();
    const h = setup();
    h.fns._lkEditReport(G(9));
    expect(h.get().LINK.rf).toMatchObject({ mode: 'edit', date: '2026-10-06', svc: 'none', ticks: { [P(61)]: true, [P(62)]: true } });
    h.fns._lkRfDate('2026-10-13');
    expect(h.get().LINK.rf.date).toBe('2026-10-06');
    h.fns._lkRfTick(P(63)); h.fns._lkRfNote({ value: 'Edited' });
    h.fns._lkReportSend();
    const it = h.fns._lkQGet()[0];
    expect(it).toMatchObject({ type: 'editReport', note: 'Edited', leaderId: 'L1' });
    expect(it.payload).toEqual({ groupId: G(1), date: '2026-10-06', didNotMeet: false, attendees: [P(61), P(62), P(63)], guests: 2, notesPrivate: false,
      serviceTimeId: null, reportId: G(9), base: { date: '2026-10-06', didNotMeet: false, attendees: [P(61), P(62)], guests: 2, serviceTimeId: null } });
  });
  it('the form no longer says what Elvanto will show; member names are escaped', () => {
    const h = setup();
    h.fns._lkNewReport();
    const form = h.fns._lkFormHtml();
    expect(form).not.toContain('Elvanto will show');
    expect(form).toContain('Ben &lt;b&gt;Sample&lt;/b&gt;');
  });
  it('a new report starts on No service; the older-than-7-days line', () => {
    const h = setup();
    h.fns._lkNewReport();
    h.fns._lkRfDate('2026-10-16');
    expect(h.get().LINK.rf.svc).toBe('none'); // operator 2026-10-17 (reverses F-25): every new report starts on No service
    expect(h.fns._lkFormHtml()).not.toContain('Older services are not listed.');
    h.fns._lkRfDate('2026-10-08');
    expect(h.fns._lkFormHtml()).toContain('Services older than 7 days are not listed. Pick No service.'); // T3 (2026-10-21)
    expect(h.fns._lkFormHtml()).not.toContain('do it in Elvanto');
    expect(h.fns._lkFormHtml()).toContain('>No service</option>');
  });
  it('a refusal from the batch shows on the group; a pending answer offers Cancel', async () => {
    const reply = (outcome: string, extra: any = {}) => (_p: string, b: any) =>
      Promise.resolve({ results: [{ id: b.items[0].id, kind: b.items[0].kind, outcome, ...extra }] });
    const h = setup('L1', {}, reply('refused', { code: 'BAD_REQUEST', reason: 'report-exists', message: 'x' }));
    h.fns._lkQSet([{ kind: 'action', id: P(70), type: 'submitReport', payload: { groupId: G(1) }, note: null, leaderId: 'L1' }]);
    await h.fns._lkFlush();
    expect(strip(h.fns._lkGroupsHtml())).toContain("There's already a report for that date. Edit it.");
    const k = setup('L1', {}, reply('saved', { action: { id: P(71), type: 'submitReport', status: 'pending', reason: null } }));
    k.fns._lkQSet([{ kind: 'action', id: P(71), type: 'submitReport', payload: { groupId: G(1) }, note: null, leaderId: 'L1' }]);
    await k.fns._lkFlush();
    expect(k.fns._lkGroupHtml(k.get().LINK.groups[0])).toContain('_lkReportCancel()');
    k.fns._lkReportCancel();
    expect(k.fns._lkQGet()[0]).toMatchObject({ kind: 'cancel', id: P(71), leaderId: 'L1', _g: G(1) });
  });
  it('T6: member changes go through the queue; the answer shows on the row; an unsent opposite is just dropped', async () => {
    const reply = (outcome: string, extra: any = {}) => (_p: string, b: any) =>
      Promise.resolve({ results: b.items.map((x: any) => ({ id: x.id, kind: x.kind, outcome, ...extra })) });
    const h = setup('L1', {}, reply('refused', { code: 'BAD_REQUEST', message: 'Already in this group.' }));
    const L = h.get().LINK;
    L.gm[G(1)] = { groupId: G(1), canEdit: true, changes: [], members: [{ personId: P(61), name: 'Ava Example', leader: false, grade: 9, studentId: null }] };
    L.gmOpen[G(1)] = true;
    // remove queued then add again before sending: the queued remove is dropped, nothing goes
    h.fns._lkMemQueue(G(1), P(61), 'removeGroupMember', 'Ava Example');
    expect(h.fns._lkQGet()).toHaveLength(1);
    expect(h.fns._lkQGet()[0]).toMatchObject({ kind: 'action', type: 'removeGroupMember', payload: { groupId: G(1), personId: P(61) }, leaderId: 'L1', note: null });
    expect(h.fns._lkMembersHtml(L.groups[0])).toContain('<s>Ava Example</s>');
    h.fns._lkMemQueue(G(1), P(61), 'addGroupMember', 'Ava Example');
    expect(h.fns._lkQGet()).toHaveLength(0);
    // an add of someone new: sent, refused by the server, shown on a greyed row with the reason; the name never leaves the phone
    h.fns._lkMemQueue(G(1), P(64), 'addGroupMember', 'Cal <b>New</b>');
    await h.fns._lkFlush();
    const sent = h.calls.posts.at(-1).b.items[0];
    expect(sent).not.toHaveProperty('_n');
    expect(h.fns._lkQGet()).toHaveLength(0);
    expect(L.mres[sent.id]).toMatchObject({ status: 'refused', personId: P(64), groupId: G(1), name: 'Cal <b>New</b>' });
    const out = h.fns._lkMembersHtml(L.groups[0]);
    expect(out).toContain('Cal &lt;b&gt;New&lt;/b&gt;');
    expect(strip(out)).toContain('Already in this group.');
    expect(h.calls.toasts).toContain('Already in this group.');
  });
  it('the page is routed; Submit and Edit hide when the console has the type off', () => {
    expect(extractFn(html, 'renderLink')).toContain("if (p === 'link-groups') { await renderLinkGroups(); return; }");
    const h = setup();
    h.get().LINK.gwk = 0; // this week (12-18 Oct) has no report
    expect(h.fns._lkGroupHtml(h.get().LINK.groups[0])).toContain("_lkNewReport('2026-10-13')");
    h.get().LINK.gwk = 1; // 5-11 Oct has the report
    expect(h.fns._lkGroupHtml(h.get().LINK.groups[0])).toContain(`_lkEditReport('${G(9)}')`);
    h.get().LINK.status = { console: { capabilities: { submitReport: 'off', editReport: 'off' } } };
    const out = h.fns._lkGroupHtml(h.get().LINK.groups[0]);
    expect(out).not.toContain('_lkEditReport(');
    expect(out).toContain('Edit this report in Elvanto.');
    h.get().LINK.gwk = 0;
    expect(h.fns._lkGroupHtml(h.get().LINK.groups[0])).not.toContain('_lkNewReport(');
  });
  it('T8: the week view steps back and forward over 8 weeks and stops at the ends', () => {
    const h = setup();
    const L = h.get().LINK;
    expect(strip(h.fns._lkGroupHtml(L.groups[0]))).toContain('Mon 12 Oct to Sun 18 OctThis week');
    h.fns._lkOpenGroup(G(1));
    L.gwk = 0;
    expect(h.fns._lkGroupHtml(L.groups[0])).toMatch(/disabled aria-label="Later week"/);
    h.fns._lkWeekGo(1); expect(L.gwk).toBe(1);
    expect(strip(h.fns._lkGroupHtml(L.groups[0]))).toContain('Mon 5 Oct to Sun 11 OctLast week');
    expect(strip(h.fns._lkGroupHtml(L.groups[0]))).toContain('DateTue 6 Oct 18:30');
    for (let i = 0; i < 10; i++) h.fns._lkWeekGo(1);
    expect(L.gwk).toBe(7);
    expect(h.fns._lkGroupHtml(L.groups[0])).toMatch(/disabled aria-label="Earlier week"/);
    for (let i = 0; i < 10; i++) h.fns._lkWeekGo(-1);
    expect(L.gwk).toBe(0);
  });
  it('T8: an older week reads from the history, and Edit opens that entry as the base', () => {
    vi.useFakeTimers();
    const old = { reportId: G(8), date: '2026-09-29', time: '19:00', didNotMeet: false, attendees: [P(63)], guests: 1, serviceTimeId: null, editable: true, blocked: null };
    const h = setup('L1', { history: [grp().lastReport, old] });
    const L = h.get().LINK;
    L.gwk = 2;
    const out = h.fns._lkGroupHtml(L.groups[0]);
    expect(strip(out)).toContain('Students here (1)Ben &lt;b&gt;Sample&lt;/b&gt;');
    h.fns._lkEditReport(G(8));
    expect(L.rf).toMatchObject({ mode: 'edit', date: '2026-09-29', reportId: G(8), ticks: { [P(63)]: true } });
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()[0].payload).toMatchObject({ date: '2026-09-29', reportId: G(8), base: { date: '2026-09-29', attendees: [P(63)], guests: 1 } });
  });
  it('T8: Submit in an empty week uses that week\'s meeting date; a blocked entry cannot be edited', () => {
    const h = setup();
    const L = h.get().LINK;
    L.gwk = 0;
    h.fns._lkNewReport('2026-10-13');
    expect(L.rf).toMatchObject({ mode: 'submit', date: '2026-10-13' });
    const b = setup('L1', { lastReport: { ...grp().lastReport, blocked: 'unkept-notes' } });
    b.get().LINK.gwk = 1;
    expect(b.fns._lkGroupHtml(b.get().LINK.groups[0])).not.toContain('_lkEditReport(');
    b.fns._lkEditReport(G(9));
    expect(b.get().LINK.rf).toBeNull();
  });
});

// ── F3 flow steps ──
describe('F3 flow steps', () => {
  const F = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const row = (n: number, over: any = {}) => ({ rowId: F(n), flowId: F(100), stepId: F(200), flowName: 'Follow up', stepName: 'Call',
    stepOrder: 1, personId: P(n), name: 'Person ' + n, due: '2026-10-20', assignedTo: 'Sam Example', openAction: null, ...over });
  const ROWS = () => [
    row(1, { flowName: 'Welcome', flowId: F(101), stepName: 'Text', stepId: F(201), stepOrder: 2, name: 'Zed Welcome-text' }),
    row(2, { flowName: 'Follow up', stepName: 'Visit', stepId: F(202), stepOrder: 2, name: 'Amy Follow-visit' }),
    row(3, { flowName: 'Follow up', stepName: 'Call', stepOrder: 1, name: 'Bo Follow-call', due: '2026-10-10' }),
    row(4, { flowName: 'Welcome', flowId: F(101), stepName: 'Hello', stepId: F(203), stepOrder: 1, name: 'Cy Welcome-hello' }),
  ];
  const setup = (leaderId: string | null = 'L1', rows: any[] = ROWS(), post?: Env['post']) => {
    const h = makeEnv({ leaderId, post });
    const L = h.get().LINK;
    L.today = '2026-10-16'; L.flows = rows; L.ldrs = [{ id: 'L1', fullName: 'Cody <b>Codeman</b>', active: true }];
    return h;
  };
  it('rows are grouped by flow, then step (step order)', () => {
    const out = strip(setup().fns._lkFlowsHtml());
    const at = (t: string) => out.indexOf(t);
    expect(at('Follow up')).toBeGreaterThanOrEqual(0);
    expect(at('Follow up')).toBeLessThan(at('Welcome'));
    expect(at('Bo Follow-call')).toBeLessThan(at('Amy Follow-visit'));
    expect(at('Amy Follow-visit')).toBeLessThan(at('Welcome'));
    expect(at('Cy Welcome-hello')).toBeLessThan(at('Zed Welcome-text'));
    expect(out.split('Follow up').length).toBe(2); // one heading per flow
  });
  it('T5: every step is a collapsed .drop with "Step · count" and a red overdue badge only when there is one', () => {
    const h = setup();
    const out = h.fns._lkFlowsHtml();
    expect(out.match(/class="drop"/g)).toHaveLength(4);
    expect(out).not.toContain('class="drop open"');
    expect(out).toContain('aria-expanded="false"');
    const call = out.split('class="drop"').find((x: string) => x.includes('Bo Follow-call'))!;
    expect(strip(call.split('drop-body')[0])).toContain('Call · 1');
    expect(call.split('drop-body')[0]).toContain('<span class="lk-od">1 overdue</span>');
    const visit = out.split('class="drop"').find((x: string) => x.includes('Amy Follow-visit'))!;
    expect(visit.split('drop-body')[0]).not.toContain('lk-od');
  });
  it('T5: an open step stays open across a refresh (LINK.fOpen), and the row shows chip and assignee', () => {
    const h = setup('L1', [row(1, { grade: 9, gender: 'female', assignedLeaderName: 'Cody <b>Codeman</b>', mobile: '0412345678' })]);
    const L = h.get().LINK;
    const id = 'lks-' + F(100) + '-' + F(200);
    L.fOpen[id] = true;
    const out = h.fns._lkFlowsHtml();
    expect(out).toContain(`class="drop open" id="${id}"`);
    expect(out).toContain('<span class="chip c-girl">Y9</span>');
    expect(out).toContain('Cody &lt;b&gt;Codeman&lt;/b&gt;');
    expect(out).not.toContain('<b>Codeman');
  });
  it('T5: tapping a row opens the detail sheet with a text link and Complete; a grade login sees who has the person, no picker', () => {
    const h = setup('L1', [row(1, { name: 'Sam Lee', grade: 8, gender: 'male', mobile: '0412345678', mobileIsParent: false, assignedLeaderId: 'L1', assignedLeaderName: 'Cody <b>Codeman</b>', currentLeaderId: 'L1', currentLeaderLinked: true })]);
    expect(h.fns._lkFlowsHtml()).toContain(`onclick="_lkOpenStep('${F(1)}')"`);
    h.fns._lkOpenStep(F(1));
    const sheet = h.calls.modals[0]!;
    expect(sheet).toContain('href="sms:0412345678');
    expect(sheet).toContain('body=Hey%20Sam%20');
    expect(strip(sheet)).toContain('Text Sam · 0412 345 678');
    expect(sheet).not.toContain('id="lk-assign"');
    expect(sheet).not.toContain('_lkReassign');
    expect(sheet).not.toContain('_lkAssign');
    expect(sheet).toContain('Assigned to: Cody &lt;b&gt;Codeman&lt;/b&gt;');
    expect(strip(sheet)).toContain('Complete gives the next step to them. Ask the admin to change it.');
    expect(sheet).toContain('_lkStepSend()');
    expect(sheet).not.toContain('Elvanto will show');
    // Elvanto's own assignee name when no app leader is known; then Elvanto picks the next leader
    const el = setup('L1', [row(1, { assignedTo: 'Sam <i>Example</i>', currentLeaderId: null })]);
    el.fns._lkOpenStep(F(1));
    expect(el.calls.modals[0]).toContain('Assigned to: Sam &lt;i&gt;Example&lt;/i&gt;');
    expect(strip(el.calls.modals[0]!)).toContain('Elvanto will pick who gets the next step. Ask the admin to change it.');
    // a known app leader with no Elvanto person: Elvanto still picks (Q9)
    const un = setup('L1', [row(1, { assignedLeaderId: 'L4', assignedLeaderName: 'Una Unlinked', currentLeaderId: 'L4', currentLeaderLinked: false })]);
    un.fns._lkOpenStep(F(1));
    expect(strip(un.calls.modals[0]!)).toContain('Elvanto will pick who gets the next step. Ask the admin to change it.');
    const nob = setup('L1', [row(1, { assignedTo: null })]);
    nob.fns._lkOpenStep(F(1));
    expect(strip(nob.calls.modals[0]!)).toContain('Assigned to: Nobody');
    const par = setup('L1', [row(1, { name: 'Sam Lee', mobile: '0412345678', mobileIsParent: true })]);
    par.fns._lkOpenStep(F(1));
    expect(strip(par.calls.modals[0]!)).toContain('Text Parent · 0412 345 678');
    const none = setup('L1', [row(1, { personId: null })]);
    none.fns._lkOpenStep(F(1));
    expect(strip(none.calls.modals[0]!)).toContain('cannot be assigned');
    expect(none.calls.modals[0]).not.toContain('Assigned to');
  });
  // 2026-10-24 flows reassign: admin/director pick from leaders who fit the person (no grades = anyone), Reassign or Complete.
  const LDRS = () => [
    { id: 'L1', name: 'Cody <b>Codeman</b>', personId: P(70), gender: 'male', grades: [8] },
    { id: 'L2', name: 'Gina Girl', personId: P(71), gender: 'female', grades: [8] },
    { id: 'L3', name: 'Dee Director', personId: P(72), gender: null, grades: [] },
    { id: 'L4', name: 'Una Unlinked', personId: null, gender: 'male', grades: [8] },
    { id: 'L5', name: 'Ted Tenner', personId: P(74), gender: 'male', grades: [10] },
  ];
  const admin = (rows: any[], post?: Env['post'], role = 'admin') => {
    const h = makeEnv({ role, leaderId: 'L1', post });
    const L = h.get().LINK;
    L.today = '2026-10-16'; L.flows = rows; L.ldrs = []; L.fLeaders = LDRS();
    return h;
  };
  const boy = (over: any = {}) => row(1, { grade: 8, gender: 'male', assignedLeaderId: 'L1', assignedLeaderName: 'Cody Codeman', currentLeaderId: 'L1', ...over });
  const pickOf = (_h: any, id: string) => id; // review #5: the pick is a leader id
  it('flows reassign: _lkFits mirrors the server rule', () => {
    const fit = makeEnv().fns._lkFits;
    expect(fit({ active: true, grades: [], gender: null }, null, 'female')).toBe(true);
    expect(fit({ active: true, grades: [], gender: 'male' }, 9, 'female')).toBe(true);
    const g8m = { active: true, grades: [8], gender: 'male' };
    expect(fit(g8m, 8, 'male')).toBe(true);
    expect(fit(g8m, 8, 'female')).toBe(false);
    expect(fit(g8m, 10, 'male')).toBe(false);
    expect(fit(g8m, null, 'male')).toBe(false);
    expect(fit({ grades: [8], gender: null }, 8, 'female')).toBe(true);
    expect(fit({ active: false, grades: [], gender: null }, 8, 'male')).toBe(false);
  });
  it('flows reassign: the admin sheet has one Assigned to select (fitting leaders), the current one picked, and Cancel | Reassign | Complete', () => {
    for (const role of ['admin', 'director']) {
      const h = admin([boy()], undefined, role);
      h.fns._lkOpenStep(F(1));
      const sheet = h.calls.modals[0]!;
      expect(sheet.match(/id="lk-assign"/g)).toHaveLength(1);
      expect(sheet).not.toContain('Next step goes to');
      expect(sheet).not.toContain('onchange="_lkAssign');
      expect(sheet).toContain(`<option value="">Nobody (Elvanto's usual pick)</option>`);
      expect(sheet).toContain('<option value="L1" selected>Cody &lt;b&gt;Codeman&lt;/b&gt;</option>');
      expect(sheet).not.toContain('<b>Codeman');
      expect(strip(sheet)).toContain('Dee Director');
      expect(strip(sheet)).toContain('Una Unlinked');
      expect(strip(sheet)).not.toContain('Gina Girl');
      expect(strip(sheet)).not.toContain('Ted Tenner');
      expect(strip(sheet)).toContain('Reassign changes who has this person. Complete gives them the next step.');
      const btns = h.fns._lkStepBtns();
      expect(btns.indexOf('closeModal()')).toBeLessThan(btns.indexOf('_lkReassign()'));
      expect(btns.indexOf('_lkReassign()')).toBeLessThan(btns.indexOf('_lkStepSend()'));
    }
    // a current assignee who does not fit is still listed and picked
    const t = admin([boy({ currentLeaderId: 'L2', assignedLeaderId: 'L2' })]);
    t.fns._lkOpenStep(F(1));
    expect(t.calls.modals[0]).toMatch(/<option value="L2" selected>Gina Girl<\/option>/);
    // nobody current: Nobody is picked
    const n = admin([boy({ currentLeaderId: null, assignedLeaderId: null })]);
    n.fns._lkOpenStep(F(1));
    expect(n.get().LINK.fs.pick).toBeNull();
    expect(n.calls.modals[0]).not.toContain(' selected');
    // DNC: Reassign, no Complete; no Elvanto person: no Reassign
    const d = admin([boy({ dnc: true })]);
    d.fns._lkOpenStep(F(1));
    expect(d.fns._lkStepBtns()).toContain('_lkReassign()');
    expect(d.fns._lkStepBtns()).not.toContain('_lkStepSend()');
    const np = admin([boy({ personId: null })]);
    np.fns._lkOpenStep(F(1));
    expect(np.fns._lkStepBtns()).not.toContain('_lkReassign');
    expect(np.calls.modals[0]).not.toContain('id="lk-assign"');
  });
  it('flows reassign: picking a leader not linked to Elvanto says Elvanto picks', () => {
    const h = admin([boy()]);
    h.fns._lkOpenStep(F(1));
    expect(strip(h.fns._lkStepHtml())).not.toContain('Not linked to an Elvanto person');
    h.get().LINK.fs.pick = pickOf(h, 'L4');
    expect(strip(h.fns._lkStepHtml())).toContain('Not linked to an Elvanto person: Elvanto picks who gets the next step.');
  });
  it('flows reassign: Reassign posts the pick (or null), updates every row of that person in the flow, closes and toasts', async () => {
    const h = admin([boy({ name: 'Sam' }), boy({ rowId: F(11), stepId: F(201), name: 'Sam' })]);
    h.fns._lkOpenStep(F(1));
    const L = h.get().LINK;
    L.fs.pick = pickOf(h, 'L3');
    await h.fns._lkReassign();
    expect(h.calls.posts[0]).toMatchObject({ p: '/link/flows/assign', b: { flowId: F(100), personId: P(1), leaderId: 'L3' } });
    expect(L.flows.map((r: any) => [r.assignedLeaderId, r.assignedLeaderName, r.currentLeaderId])).toEqual([['L3', 'Dee Director', 'L3'], ['L3', 'Dee Director', 'L3']]);
    expect(h.calls.closed).toBe(1);
    expect(L.fs).toBeNull();
    expect(h.calls.toasts).toContain('Assigned to Dee Director');
    expect(h.fns._lkQGet()).toEqual([]); // not completed
    h.fns._lkOpenStep(F(1));
    L.fs.pick = null;
    await h.fns._lkReassign();
    expect(h.calls.posts[1].b.leaderId).toBeNull();
    expect(L.flows.map((r: any) => r.currentLeaderId)).toEqual([null, null]);
    expect(h.calls.toasts).toContain('Unassigned');
  });
  it('review #5: the pick follows the leader id when the list is rebuilt under the sheet', () => {
    const h = admin([boy()]);
    h.fns._lkOpenStep(F(1));
    const L = h.get().LINK;
    L.fs.pick = 'L4';
    L.fLeaders = LDRS().filter((l: any) => l.id !== 'L3'); // a refresh drops a leader sorted before Una
    expect(h.fns._lkStepHtml()).toContain('<option value="L4" selected>Una Unlinked</option>');
    L.fs.pick = 'L3'; // a picked leader gone from the list = Nobody, never a neighbour
    h.fns._lkStepSend();
    expect('assignTo' in h.fns._lkQGet()[0].payload).toBe(false);
  });
  it('flows reassign: a failed Reassign toasts and changes nothing', async () => {
    const h = admin([boy()], (p) => (p === '/link/flows/assign' ? Promise.reject(new Error('nope')) : Promise.resolve({ results: [] })));
    h.fns._lkOpenStep(F(1));
    const L = h.get().LINK;
    L.fs.pick = pickOf(h, 'L3');
    await h.fns._lkReassign();
    expect(L.flows[0]).toMatchObject({ assignedLeaderId: 'L1', currentLeaderId: 'L1' });
    expect(h.calls.toasts).toContain('nope');
    expect(h.calls.closed).toBe(0);
  });
  it('T6: the Home card lists only my people, hidden when there are none', () => {
    const h = setup('L1', [row(1, { name: 'Sam Lee', grade: 8, gender: 'male', mobile: '0412345678', assignedLeaderId: 'L1', due: '2026-10-01' }),
      row(2, { name: 'Eve Other', assignedLeaderId: 'L2' }), row(3, { name: 'Nia NoPhone', assignedLeaderId: 'L1', mobile: null })]);
    const out = h.fns._lkHomeFlowsHtml();
    expect(strip(out)).toContain('My flow people');
    expect(out).toContain('Sam Lee');
    expect(out).toContain('Nia NoPhone');
    expect(out).not.toContain('Eve Other');
    expect(out).toContain('href="sms:0412345678');
    expect(strip(out)).toContain('Call · Overdue');
    expect(out.match(/<a /g)).toHaveLength(1); // no mobile: not a link
    expect(setup(null).fns._lkHomeFlowsHtml()).toBe('');
    expect(setup('L9').fns._lkHomeFlowsHtml()).toBe('');
  });
  it('RFIX: a failed Home flows load is not retried on every render', async () => {
    let n = 0;
    const h = makeEnv({ leaderId: 'L1', fresh: () => { n++; return Promise.reject(new Error('down')); } });
    await h.fns._lkHomeFlows(); await h.fns._lkHomeFlows(); await h.fns._lkHomeFlows();
    expect(n).toBe(1);
  });
  it('a past due date is red; today or later is not', () => {
    const rows = setup().fns._lkFlowsHtml().split('lk-row').slice(1);
    const late = rows.find((r: string) => r.includes('Bo Follow-call'))!;
    const ok = rows.find((r: string) => r.includes('Amy Follow-visit'))!;
    expect(late).toContain('lk-late');
    expect(ok).not.toContain('lk-late');
    expect(strip(late)).toContain('Due Sat 10 Oct');
  });
  it('a row with an open action (or one still on the phone) cannot be completed', () => {
    const h = setup('L1', [row(1, { openAction: { id: P(90), type: 'completeStep', status: 'pending', reason: null } }), row(2)]);
    const rows = h.fns._lkFlowsHtml().split('lk-row').slice(1);
    expect(strip(rows[0])).toContain('Waiting for Elvanto.');
    // the detail sheet still opens (text, assign) but offers no Complete
    h.fns._lkOpenStep(F(1));
    expect(h.calls.modals).toHaveLength(1);
    expect(h.calls.modals[0]).not.toContain('_lkStepSend');
    h.fns._lkOpenStep(F(2));
    expect(h.calls.modals[1]).toContain('_lkStepSend');
    h.fns._lkQSet([{ kind: 'action', id: P(91), type: 'completeStep', payload: { rowId: F(2) }, note: null, leaderId: 'L1' }]);
    h.get().LINK.fs = null;
    h.fns._lkOpenStep(F(2));
    expect(h.calls.modals[2]).not.toContain('_lkStepSend');
    // a refused or cancelled answer can be completed again
    const k = setup('L1', [row(1, { openAction: { id: P(92), type: 'completeStep', status: 'refused', reason: 'step-moved' } })]);
    k.fns._lkOpenStep(F(1));
    expect(k.calls.modals[0]).toContain('_lkStepSend');
  });
  it('Complete needs "I am": the picker opens when it is tapped without one; the sheet itself opens either way', () => {
    const h = setup(null);
    h.fns._lkOpenStep(F(2));
    expect(h.calls.modals).toHaveLength(1);
    expect(h.calls.modals[0]).toContain('Amy Follow-visit');
    h.fns._lkStepSend();
    expect(h.calls.modals).toHaveLength(2);
    expect(h.calls.modals[1]).toContain('Who are you?');
    expect(h.get().LINK.iamThen).toBeTypeOf('function');
    const k = setup('L1');
    k.fns._lkOpenStep(F(2));
    expect(k.calls.modals[0]).toContain('Complete');
    expect(k.calls.modals[0]).toContain('Amy Follow-visit');
  });
  it('the note stops at 1,800; Keep note private is shown; the old warning lines are gone', () => {
    const h = setup();
    h.fns._lkOpenStep(F(2));
    const sheet = h.calls.modals[0]!;
    expect(sheet).toContain('maxlength="1800"');
    expect(strip(sheet)).toContain('Keep note private');
    expect(strip(sheet)).not.toContain('Completing may send');
    const el = { value: 'y'.repeat(2500) };
    h.fns._lkStepNote(el);
    expect(el.value).toHaveLength(1800);
    expect(h.get().LINK.fs.note).toHaveLength(1800);
    expect(h.fns._lkStepHtml()).toContain('1,800 / 1,800');
  });
  it('Complete queues completeStep with the raw note and notePrivate; the row then waits', () => {
    vi.useFakeTimers();
    const h = setup();
    h.fns._lkOpenStep(F(2));
    h.fns._lkStepNote({ value: 'Called, all good' });
    h.get().LINK.fs.priv = true;
    h.fns._lkStepSend();
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(1);
    expect(Object.keys(q[0]).sort()).toEqual(['_at', '_f', 'id', 'kind', 'leaderId', 'note', 'payload', 'type', 'v']);
    expect(q[0]).toMatchObject({ kind: 'action', type: 'completeStep', note: 'Called, all good', leaderId: 'L1', _f: F(2) });
    expect(q[0].payload).toEqual({ rowId: F(2), flowId: F(100), stepId: F(202), personId: P(2), notePrivate: true });
    expect(h.calls.closed).toBe(1);
    expect(strip(h.fns._lkFlowsHtml())).toContain('Waiting to send.');
    h.fns._lkStepUndo(F(2));
    expect(h.fns._lkQGet()).toEqual([]);
    // a blank note goes as null; private defaults off
    h.fns._lkOpenStep(F(2)); h.fns._lkStepNote({ value: '  ' }); h.fns._lkStepSend();
    expect(h.fns._lkQGet()[0]).toMatchObject({ note: null, payload: { notePrivate: false } });
  });
  it('flows reassign: an admin Complete sends the pick as payload.assignTo and reassigns once when the pick changed', () => {
    const h = admin([boy()]);
    h.fns._lkOpenStep(F(1));
    h.fns._lkStepSend(); // the current assignee, unchanged: no assign post
    expect(h.calls.posts.filter((c: any) => c.p === '/link/flows/assign')).toHaveLength(0);
    expect(h.fns._lkQGet()[0].payload).toEqual({ rowId: F(1), flowId: F(100), stepId: F(200), personId: P(1), notePrivate: false, assignTo: P(70) });
    const k = admin([boy()]);
    k.fns._lkOpenStep(F(1));
    k.get().LINK.fs.pick = pickOf(k, 'L3');
    k.fns._lkStepSend();
    expect(k.calls.posts.filter((c: any) => c.p === '/link/flows/assign')).toEqual([expect.objectContaining({ b: { flowId: F(100), personId: P(1), leaderId: 'L3' } })]);
    expect(k.fns._lkQGet()[0].payload.assignTo).toBe(P(72));
    // an unlinked pick or Nobody: no assignTo key (Elvanto's usual pick)
    for (const id of ['L4', null]) {
      const u = admin([boy()]);
      u.fns._lkOpenStep(F(1));
      u.get().LINK.fs.pick = id;
      u.fns._lkStepSend();
      expect('assignTo' in u.fns._lkQGet()[0].payload).toBe(false);
    }
  });
  it('flows reassign: a grade login Complete never sends assignTo (the server sets it)', () => {
    const leader = setup('L1', [row(2, { currentLeaderId: 'L1' })]);
    leader.get().LINK.fLeaders = LDRS();
    leader.fns._lkOpenStep(F(2));
    leader.get().LINK.fs.pick = 'L3';
    leader.fns._lkStepSend();
    expect('assignTo' in leader.fns._lkQGet()[0].payload).toBe(false);
    expect(leader.calls.posts.filter((c: any) => c.p === '/link/flows/assign')).toHaveLength(0);
  });
  it('flows reassign: _lkLoadFlows keeps leaders as LINK.fLeaders (assignees is gone)', async () => {
    const h = makeEnv({ role: 'admin', fresh: () => Promise.resolve({ rows: [], steps: [], leaders: LDRS() }) });
    await h.fns._lkLoadFlows(true);
    expect(h.get().LINK.fLeaders).toEqual(LDRS());
    expect(h.get().LINK.fAssignees).toBeUndefined();
    const o = makeEnv({ role: 'grade', fresh: () => Promise.resolve({ rows: [], steps: [] }) });
    await o.fns._lkLoadFlows(true);
    expect(o.get().LINK.fLeaders).toEqual([]);
  });
  it('every value is escaped, in the list and in the sheet', () => {
    const h = setup('L1', [row(1, { name: 'Ann <b>X</b>', flowName: 'F <i>1</i>', stepName: 'S <u>1</u>', assignedTo: 'Al <s>Y</s>' })]);
    const list = h.fns._lkFlowsHtml();
    for (const raw of ['<b>X', '<i>1', '<u>1', '<s>Y']) expect(list).not.toContain(raw);
    expect(list).toContain('Ann &lt;b&gt;X&lt;/b&gt;');
    h.fns._lkOpenStep(F(1));
    for (const raw of ['<b>X', '<i>1', '<u>1']) expect(h.calls.modals[0]).not.toContain(raw);
    expect(h.calls.modals[0]).toContain('Ann &lt;b&gt;X&lt;/b&gt;');
    expect(h.calls.modals[0]).not.toContain('Elvanto will show');
  });
  it('a refusal from the batch shows on the row; a pending answer offers Cancel', async () => {
    const reply = (outcome: string, extra: any = {}) => (_p: string, b: any) =>
      Promise.resolve({ results: [{ id: b.items[0].id, kind: b.items[0].kind, outcome, ...extra }] });
    const h = setup('L1', [row(1)], reply('refused', { code: 'CONFLICT', reason: 'step-moved', message: 'x' }));
    h.fns._lkQSet([{ kind: 'action', id: P(80), type: 'completeStep', payload: { rowId: F(1) }, note: null, leaderId: 'L1', _f: F(1) }]);
    await h.fns._lkFlush();
    expect(h.calls.posts[0].b.items[0]._f).toBeUndefined();
    expect(strip(h.fns._lkFlowsHtml())).toContain('This step changed in Elvanto. Reload and try again.'); // fix16 F-35; r21 L6b: reload, no Elvanto step
    expect(h.calls.toasts).toEqual([]);
    const k = setup('L1', [row(1)], reply('saved', { action: { id: P(81), type: 'completeStep', status: 'pending', reason: null } }));
    k.fns._lkQSet([{ kind: 'action', id: P(81), type: 'completeStep', payload: { rowId: F(1) }, note: null, leaderId: 'L1', _f: F(1) }]);
    await k.fns._lkFlush();
    expect(k.fns._lkFlowsHtml()).toContain(`_lkStepCancel('${F(1)}')`);
    k.fns._lkStepCancel(F(1));
    expect(k.fns._lkQGet()[0]).toMatchObject({ kind: 'cancel', id: P(81), leaderId: 'L1', _f: F(1) });
  });
  it('the page is routed; Complete hides when the console has completeStep off', () => {
    expect(extractFn(html, 'renderLink')).toContain("if (p === 'link-flows') { await renderLinkFlows(); return; }");
    const h = setup();
    h.get().LINK.status = { console: { capabilities: { completeStep: 'off' } } };
    h.fns._lkOpenStep(F(2));
    expect(h.calls.modals[0]).not.toContain('_lkStepSend');
    expect(h.calls.modals[0]).toContain('Close');
  });
  // ── run 2026-10-15 lane B (R1 / R4) ──
  const boss = (rows: any[] = ROWS(), post?: Env['post']) => {
    const h = makeEnv({ role: 'admin', leaderId: 'L1', post });
    const L = h.get().LINK;
    L.today = '2026-10-16'; L.flows = rows; L.ldrs = [];
    return h;
  };
  it('R4 bulk: Complete N queues one completeStep per ticked row with the same note; DNC rows are skipped', () => {
    vi.useFakeTimers();
    const h = boss([row(1), row(2), row(3, { dnc: true, consent: 'all' })]);
    const L = h.get().LINK;
    L.fsel = { [F(1)]: true, [F(2)]: true, [F(3)]: true };
    expect(strip(h.fns._lkFlowsHtml())).toContain('2 selected');
    h.fns._lkBulkOpen();
    expect(h.calls.modals[0]).toContain('Complete 2');
    L.fb.note = 'Rang them'; L.fb.priv = true;
    h.fns._lkBulkSend();
    const q = h.fns._lkQGet();
    expect(q.map((x: any) => x.payload.rowId)).toEqual([F(1), F(2)]);
    expect(new Set(q.map((x: any) => x.id)).size).toBe(2);
    q.forEach((x: any) => expect(x).toMatchObject({ type: 'completeStep', note: 'Rang them', leaderId: 'L1', payload: { notePrivate: true } }));
    expect(L.fsel).toEqual({});
    expect(strip(h.fns._lkFlowsHtml())).toContain('Waiting to send.');
  });
  it('R4 bulk: needs "I am" first; leaders never get tick boxes or chips', () => {
    const h = makeEnv({ role: 'admin', leaderId: null });
    h.get().LINK.flows = [row(1)]; h.get().LINK.fsel = { [F(1)]: true }; h.get().LINK.ldrs = [{ id: 'L1', fullName: 'Cody', active: true }];
    h.fns._lkBulkOpen();
    expect(h.calls.modals[0]).toContain('Who are you?');
    const g = setup('L1', [row(1)]);
    const out = g.fns._lkFlowsHtml();
    expect(out).not.toContain('lk-tick');
    expect(out).not.toContain('Junior Guys');
  });
  it('R1 DNC sheet: red banner, no Text, no Complete; admin still sees the number and can Remove', () => {
    const h = boss([row(1, { dnc: true, consent: 'contact', mobile: '0412345678' })]);
    h.fns._lkOpenStep(F(1));
    const sheet = h.calls.modals[0]!;
    expect(sheet).toContain('DO NOT CONTACT');
    expect(sheet).not.toContain('sms:');
    expect(sheet).not.toContain('_lkStepSend');
    expect(sheet).toContain('0412 345 678');
    expect(sheet).toContain('_lkRemoveAsk()');
  });
  it('R4 Remove: confirm view, optional note, queues removeFromFlowStep (no "I am" needed without a note)', () => {
    vi.useFakeTimers();
    const h = makeEnv({ role: 'director', leaderId: null });
    h.get().LINK.flows = [row(1)];
    h.fns._lkOpenStep(F(1));
    h.fns._lkRemoveAsk();
    expect(strip(h.fns._lkStepHtml())).toContain('Remove Person 1?');
    expect(h.fns._lkStepBtns()).toContain('_lkRemoveSend()');
    h.fns._lkRemoveSend();
    const q = h.fns._lkQGet();
    expect(q[0]).toMatchObject({ kind: 'action', type: 'removeFromFlowStep', note: null, leaderId: null, _f: F(1),
      payload: { rowId: F(1), flowId: F(100), stepId: F(200), personId: P(1) } });
    expect(q[0].payload.notePrivate).toBeUndefined();
    // with a note "I am" is asked first
    const k = makeEnv({ role: 'admin', leaderId: null });
    k.get().LINK.flows = [row(2)]; k.get().LINK.ldrs = [{ id: 'L1', fullName: 'Cody', active: true }];
    k.fns._lkOpenStep(F(2)); k.fns._lkRemoveAsk(); k.get().LINK.fs.rmNote = 'Moved church';
    k.fns._lkRemoveSend();
    expect(k.fns._lkQGet()).toEqual([]);
    expect(k.calls.modals[1]).toContain('Who are you?');
  });
  it('R4 Remove is hidden for leaders', () => {
    const h = setup('L1', [row(1, { dnc: true })]);
    h.fns._lkOpenStep(F(1));
    expect(h.calls.modals[0]).not.toContain('_lkRemoveAsk');
  });
  it('R4 refusals show honestly on the row: locked note path, CONSENT_CHECK_FIRST', async () => {
    const reply = (id: string, outcome: string, extra: any) => () => Promise.resolve({ results: [{ id, kind: 'action', outcome, ...extra }] });
    const h = boss([row(1)], reply(P(90), 'refused', { code: 'LINK_LOCKED', reason: 'locked', message: 'x' }));
    h.fns._lkQSet([{ kind: 'action', id: P(90), type: 'removeFromFlowStep', payload: { rowId: F(1) }, note: 'n', leaderId: 'L1', _f: F(1) }]);
    await h.fns._lkFlush();
    // r21 L6b (T5): remove with a note is live (personNote); a locked refusal reads as the plain locked line, never "not switched on"
    expect(strip(h.fns._lkFlowsHtml())).not.toContain('switched on');
    expect(strip(h.fns._lkFlowsHtml())).toContain("This isn't connected yet.");
    const k = boss([row(2, { consentStep: true, consent: 'ok' })], reply(P(91), 'refused', { code: 'CONSENT_CHECK_FIRST', message: 'Do the consent check first (New youth & consent > Consents).' }));
    k.fns._lkQSet([{ kind: 'action', id: P(91), type: 'completeStep', payload: { rowId: F(2) }, note: null, leaderId: 'L1', _f: F(2) }]);
    await k.fns._lkFlush();
    expect(strip(k.fns._lkFlowsHtml())).toContain('Do the consent check first');
  });
  it('R4 consent step, consent hub (Task 11): with New youth & consent on, step 0 is read-only here and links to the hub', () => {
    const h = makeEnv({ role: 'admin', leaderId: 'L1', modules: { intakeAdmin: 'on' } });
    h.get().LINK.flows = [row(1, { consentStep: true, consent: 'unknown' })];
    h.fns._lkOpenStep(F(1));
    expect(h.calls.modals[0]).not.toContain('_lkStepSend');
    expect(h.calls.modals[0]).not.toContain('_lkRemoveAsk');
    expect(strip(h.calls.modals[0]!)).not.toContain('Do the consent check first'); // the hub button says where instead
    expect(h.calls.modals[0]).toContain('onclick="_lkStepConsents()">Open in New youth &amp; consent');
  });
  it('R4 consent step, module off: Complete off until consent is ok, the reason shown, no hub button', () => {
    const h = makeEnv({ role: 'admin', leaderId: 'L1' });
    h.get().LINK.flows = [row(1, { consentStep: true, consent: 'unknown' })];
    h.fns._lkOpenStep(F(1));
    expect(h.calls.modals[0]).not.toContain('_lkStepSend');
    expect(strip(h.calls.modals[0]!)).toContain('Do the consent check first');
    expect(h.calls.modals[0]).not.toContain('_lkStepConsents');
  });
  it('R8 console offline: red line on the flows banner for admin/director only', () => {
    const st = { console: { lastSeenAt: new Date(Date.now() - 20 * 60000).toISOString(), online: false, capabilities: {} } };
    expect(strip(boss().fns._lkBanner(['completeStep'], st))).toContain('No link to Elvanto since'); // fix16 F-12 wording
    expect(boss().fns._lkBanner(['completeStep'], st)).toContain('lk-alert bad');
    expect(strip(setup().fns._lkBanner(['completeStep'], st))).not.toContain('No link to Elvanto'); // fix16 F-12: leaders get the pill only
    const fresh = { console: { lastSeenAt: new Date(Date.now() - 5 * 60000).toISOString(), online: true, inWindow: true, capabilities: {} } };
    expect(strip(boss().fns._lkBanner(['completeStep'], fresh))).not.toContain('offline');
  });
});

// ── T11 (2026-10-12): the first-timer tick is gone from the New person form ──
describe('T11 first-timer check-in removed from New person', () => {
  it('no tick, no send path, no dead helpers', () => {
    for (const name of ['_nyLinkHtml', '_nyLkRead', '_lkFirstTimerAfter', '_lkFirstTimerDecision', '_lkFirstTimerPayload', '_nyFtLine', '_nyFtListHtml', '_lkFtLoad', '_lkFtRow']) {
      expect(html, name).not.toContain('function ' + name + '(');
    }
    expect(html).not.toContain('ny-lk');
    const send = extractFn(html, 'nySend');
    expect(send).not.toContain('lkSvc');
    expect(send).not.toContain('_lkFirstTimerAfter');
    // C-B9/D3 (n4): the send list moved to a const and the POST carries the request id + keepalive
    expect(send).toContain("const sendList = send || (mine.sibling ? ['student'] : ['student', 'parent']);");
    expect(send).toContain("API.post('/intake/new-youth', { ...p, send: sendList, requestId: req.id }, 45000, false, true)");
    expect(extractFn(html, 'renderNewYouth')).not.toMatch(/NY\.lkNote|_nyFt|_nyLinkHtml/);
  });
});

describe('B18 / T-8 an empty flows push', () => {
  it('an empty list reads "No flow steps for this login." with no rows', () => {
    const h = makeEnv();
    h.get().LINK.flows = [];
    const out = h.fns._lkFlowsHtml();
    expect(strip(out)).toBe('No flow steps for this login.');
    expect(out).not.toContain('lk-row');
  });
});

describe('B17 / T-2 first-timer status on the admin page', () => {
  it('the admin page lists first-timers that have waited over 1 h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:30:00.000Z'));
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.status = { console: { lastSeenAt: null, online: false, inWindow: false, pollSeconds: null, capabilities: null, consoles: 0 }, mirrors: {} };
    h.get().LINK.adm = h.fns._lkAdmFresh();
    h.get().LINK.adm.acts = [
      { id: P(1), type: 'firstTimerCheckIn', status: 'pending', reason: 'awaiting-approval', createdAt: '2026-10-16T09:00:00.000Z', name: 'Old <i>One</i>', leaderName: 'Dana' },
      { id: P(2), type: 'firstTimerCheckIn', status: 'pending', reason: null, createdAt: '2026-10-16T10:00:00.000Z', name: 'New One', leaderName: 'Dana' },
      { id: P(3), type: 'firstTimerCheckIn', status: 'sent', reason: null, createdAt: '2026-10-16T08:00:00.000Z', name: 'Done One', leaderName: 'Dana' }];
    const out = strip(h.fns._lkAdmStatusHtml());
    expect(out).toContain('First-timers waiting over 1 hour');
    expect(out).toContain('Old &lt;i&gt;One&lt;/i&gt;');
    expect(out).not.toContain('New One');
    expect(out).not.toContain('Done One');
  });
});

// ── F4.2 Elvanto link admin page ──
describe('A5 / T-41 matching on a phone, disabled buttons', () => {
  it('a candidate row has its own class: the text shrinks, the Match button stays its own size', () => {
    expect(html).toMatch(/\.lk-cand span\{flex:1 1 auto;min-width:0\}/);
    expect(html).toMatch(/\.lk-cand \.btn\{flex:none\}/);
    expect(html).toContain('.lk-kv{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:5px 0;border-bottom:1px solid var(--line)}');
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.adm = { ...h.fns._lkAdmFresh(), mf: 'none', roster: [{ personId: P(1), name: 'Ava Example', grade: 9, kind: 'student',
      match: 'none', studentId: null, candidates: [{ studentId: P(2), name: 'Ava Example', grade: 9, gender: 'female', dob: '2011-05-01' }] }] };
    expect(h.fns._lkAdmMatchHtml()).toContain('<div class="lk-kv lk-cand">');
  });
  it('A6: an inactive holder in Set by hand is marked and can be cleared', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.adm = { ...h.fns._lkAdmFresh(), mf: 'manual', roster: [{ personId: P(1), name: 'Ava Example', grade: 9, kind: 'student',
      active: false, match: 'manual', studentId: P(2), candidates: [] }] };
    const out = h.fns._lkAdmMatchHtml();
    expect(strip(out)).toContain('No longer in Elvanto');
    expect(out).toContain('Clear');
  });
  it('a disabled button is faded (.45) and not clickable-looking', () => {
    expect(html).toContain('.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}');
  });
});

describe('F4.2 admin page', () => {
  const logRow = (over: any = {}) => ({ id: P(300), at: '2026-10-16T08:31:02.120Z', userId: 'u1', login: 'grade9<b>g</b>', deviceId: 'dev-<1>',
    deviceLabel: 'iPhone · <i>Safari</i>', event: 'identity', leaderId: P(301), leaderName: 'Sam <u>S</u>', prevLeaderId: P(302),
    prevLeaderName: 'Cody <s>C</s>', targetKind: null, targetId: null, targetName: null, outboxId: null, outcome: 'logged', ...over });
  it('three cards render: Status, Matching, Activity (the kiosk check is gone, Y-C1)', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.today = '2026-10-16';
    const out = h.fns._lkAdminHtml();
    for (const id of ['lk-adm-status', 'lk-adm-match', 'lk-adm-log']) expect(out).toContain(`id="${id}"`);
    expect(out).not.toContain('lk-adm-shadow');
    const text = strip(out);
    for (const t of ['Status', 'Matching', 'Activity']) expect(text).toContain(t);
    expect(text).not.toContain('Kiosk vs app check');
  });
  it('A4 / X17: the Status card says how to stop all data flow', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.status = { console: { lastSeenAt: null, online: false, inWindow: false, pollSeconds: null, capabilities: null, consoles: 0 }, mirrors: {} };
    h.get().LINK.adm = h.fns._lkAdmFresh ? h.fns._lkAdmFresh() : { acts: [] };
    expect(strip(h.fns._lkAdmStatusHtml())).toContain('Each link screen has its own switch in Youth Setup, Modules. To stop all data flow, also Turn off the link on the console.');
  });
  it('B3 / T-7: an unclear check-in shows the name and "Check in" in the Today card, escaped', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.status = { console: { lastSeenAt: null, online: false, inWindow: false, pollSeconds: null, capabilities: null, consoles: 0 }, mirrors: {} };
    h.get().LINK.adm = h.fns._lkAdmFresh();
    h.get().LINK.adm.acts = [{ id: P(1), type: 'checkIn', status: 'unclear', reason: 'lease-lost', detail: null, name: 'Amy <b>A</b>',
      leaderName: 'Dana Day', login: 'grade9g' }, { id: P(2), type: 'checkIn', status: 'sent', reason: null }];
    const out = h.fns._lkAdmStatusHtml();
    expect(out).toContain('Amy &lt;b&gt;A&lt;/b&gt;');
    expect(strip(out)).toContain('Check in · Amy &lt;b&gt;A&lt;/b&gt; · by Dana Day');
  });
  it('an identity row reads "Cody -> Sam (iPhone · Safari)" with an SVG arrow and all three values escaped', () => {
    const h = makeEnv({ role: 'admin' });
    const who = h.fns._lkLogWho(logRow());
    expect(who).toBe('Cody &lt;s&gt;C&lt;/s&gt; <svg data-ic="arrr"></svg> Sam &lt;u&gt;S&lt;/u&gt; (iPhone · &lt;i&gt;Safari&lt;/i&gt;)');
    const row = h.fns._lkLogRowHtml(logRow());
    for (const raw of ['<b>g', '<i>Safari', '<u>S', '<s>C']) expect(row).not.toContain(raw);
    expect(row).toContain('grade9&lt;b&gt;g&lt;/b&gt;');
    const act = h.fns._lkLogRowHtml(logRow({ event: 'checkIn', prevLeaderName: null, targetKind: 'person', targetName: 'Ava <b>E</b>', outcome: 'saved' }));
    expect(act).toContain('Ava &lt;b&gt;E&lt;/b&gt;');
    expect(strip(act)).toContain('Check-in');
  });
  it('the export file name is elvanto-activity-YYYY-MM-DD.xlsx; one sheet, same columns as the list plus the device id', () => {
    const h = makeEnv({ role: 'admin' });
    expect(h.fns._lkLogFile('2026-10-16')).toBe('elvanto-activity-2026-10-16.xlsx');
    const aoa = h.fns._lkLogAoa([logRow()]);
    expect(aoa[0]).toEqual(['Time', 'Login', 'Device', 'Device id', 'I am before', 'I am', 'Event', 'Target', 'Outcome']);
    expect([aoa[1][0].replace(/ 2026,/, ','), ...aoa[1].slice(1)]).toEqual(['Fri 16 Oct, 6:31pm', 'grade9<b>g</b>', 'iPhone · <i>Safari</i>', 'dev-<1>', 'Cody <s>C</s>', 'Sam <u>S</u>', 'Identity', '', 'logged']);
    const ex = extractFn(html, '_lkLogExport');
    expect(ex).toContain('await _ensureXlsx()');
    expect(ex).toContain('XLSX.writeFile(wb, _lkLogFile(_lkToday()))');
    expect(ex.match(/book_append_sheet/g)).toHaveLength(1);
  });
  it('_lkLastFriday is the Friday on or before a day', () => {
    const f = makeEnv().fns._lkLastFriday;
    expect(f('2026-10-16')).toBe('2026-10-16'); // a Friday
    expect(f('2026-10-17')).toBe('2026-10-16');
    expect(f('2026-10-22')).toBe('2026-10-16');
    expect(f('2026-10-15')).toBe('2026-10-09');
  });
  it('the page is not reachable for quad, grade or leader', async () => {
    for (const role of ['quad', 'grade', 'leader']) {
      const h = makeEnv({ role });
      await h.fns.renderLink('link-admin');
      expect(h.calls.gos).toEqual(['home']);
      expect(h.calls.apps).toHaveLength(0);
    }
    expect(extractFn(html, 'renderLink')).toContain("if (p === 'link-admin') { await renderLinkAdmin(); return; }");
  });
  it('matching lists Unmatched and Several possible with candidates and their DOB, escaped', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.adm.roster = [
      { personId: P(400), name: 'Ava <b>X</b>', grade: 8, kind: 'student', match: 'none', studentId: null,
        candidates: [{ studentId: P(401), name: 'Ava <i>Y</i>', grade: 8, gender: 'female', dob: '2012-04-03' }] },
      { personId: P(402), name: 'Bo Two', grade: 9, kind: 'student', match: 'ambiguous', studentId: null, candidates: [] },
      { personId: P(403), name: 'Done Already', grade: 9, kind: 'student', match: 'auto', studentId: P(404), candidates: [] },
    ];
    const out = h.fns._lkAdmMatchHtml();
    expect(out).toContain('Ava &lt;b&gt;X&lt;/b&gt;');
    expect(out).toContain('Ava &lt;i&gt;Y&lt;/i&gt;');
    expect(out).toContain('2012-04-03');
    expect(out).toContain(`_lkAdmMatch('${P(400)}','${P(401)}')`);
    expect(out).toContain(`_lkAdmIgnore('${P(400)}')`);
    expect(strip(out)).toContain('Not in YS');
    expect(out).not.toContain('Done Already');
    h.get().LINK.adm.mf = 'ambiguous';
    expect(h.fns._lkAdmMatchHtml()).toContain('Bo Two');
  });
  it('2026-10-14 clarity: sides labelled, born, no-surname text, Several possible, Set by hand split', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.adm.roster = [
      { personId: P(410), name: 'Olivia FS', grade: 7, kind: 'student', match: 'none', studentId: null,
        candidates: [{ studentId: P(411), name: 'Olivia FS', grade: 7, dob: '2013-12-15' }] },
      { personId: P(412), name: 'Nobody Here', grade: 7, kind: 'student', match: 'none', studentId: null, candidates: [] },
      { personId: P(413), name: 'Hand Made', grade: 8, kind: 'student', match: 'manual', studentId: P(414), candidates: [] },
      { personId: P(415), name: 'Not Ours', grade: 8, kind: 'student', match: 'ignored', studentId: null, candidates: [] },
    ];
    const out = strip(h.fns._lkAdmMatchHtml());
    expect(out).toContain('Elvanto: Olivia FS');
    expect(out).toContain('In YS: Olivia FS · Yr 7 · born 2013-12-15');
    expect(out).toContain('Not a YS student yet.');
    expect(out).toContain('Several possible');
    h.get().LINK.adm.mf = 'manual';
    const m = strip(h.fns._lkAdmMatchHtml());
    expect(m.indexOf('Matched by hand')).toBeLessThan(m.indexOf('Hand Made'));
    expect(m.indexOf('Marked Not in YS')).toBeLessThan(m.indexOf('Not Ours'));
    expect(m.indexOf('Hand Made')).toBeLessThan(m.indexOf('Marked Not in YS'));
  });
  it('round 2026-10-21 (L3): an Unmatched row with a same-name YS student says why, per row', () => {
    const h = makeEnv({ role: 'admin' });
    const cand = [{ studentId: P(431), name: 'Sam Same', grade: 9, dob: null }];
    h.get().LINK.adm.roster = [
      { personId: P(430), name: 'Sam Same', grade: 9, kind: 'student', match: 'none', studentId: null, candidates: cand, why: 'gender' },
      { personId: P(432), name: 'Dup Same', grade: 9, kind: 'student', match: 'none', studentId: null, candidates: [], why: 'held' },
      { personId: P(433), name: 'New Same', grade: 9, kind: 'student', match: 'none', studentId: null, candidates: cand, why: 'later' },
    ];
    const out = strip(h.fns._lkAdmMatchHtml());
    expect(out).toContain('In YS: Sam Same');
    expect(out).toContain('Same name in YS, but the genders differ. Check the gender, then Match.');
    expect(out).toContain('Same name in YS, already matched to another Elvanto profile (likely a duplicate).');
    expect(out).toContain('Same name in YS. It pairs by itself at the next update, or tap Match.');
    expect(out).not.toContain('Not a YS student yet.'); // the same-name rows say why instead
  });
  it('round 2026-10-21 (L3 r2): an Unmatched row with no YS student says it is in YS only from Elvanto', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.adm.roster = [
      { personId: P(440), name: 'Flo Only', grade: 12, kind: 'student', match: 'none', studentId: null, candidates: [], seenIn: ['flow', 'lifegroup'] },
      { personId: P(441), name: 'Nowhere Else', grade: 8, kind: 'student', match: 'none', studentId: null, candidates: [] },
    ];
    const out = strip(h.fns._lkAdmMatchHtml());
    expect(out).toContain('Not a YS student yet. YS shows them from Elvanto, in Flows and Lifegroups.');
    expect(out.split('Not a YS student yet.').length - 1).toBe(2);
  });
  it('round 2026-10-21 (L3 r3): Create all / Create on the no-candidate rows, after a confirm with the count', async () => {
    const h = makeEnv({ role: 'admin', post: () => Promise.resolve({ created: 1, skipped: { sameNameTwice: 1 } }) });
    h.get().LINK.adm.roster = [
      { personId: P(450), name: 'Make Me', grade: 8, kind: 'student', match: 'none', studentId: null, candidates: [], create: true },
      { personId: P(451), name: 'Has One', grade: 9, kind: 'student', match: 'none', studentId: null, candidates: [{ studentId: P(452), name: 'Has One', grade: 9, dob: null }] },
    ];
    const out = h.fns._lkAdmMatchHtml();
    expect(out).toContain('_lkAdmCreate(null)');
    expect(strip(out)).toContain('Create all (1)');
    expect(out).toContain(`_lkAdmCreate('${P(450)}')`);
    expect(out).not.toContain(`_lkAdmCreate('${P(451)}')`);
    h.answers.push(false);
    await h.fns._lkAdmCreate(null);
    expect(h.calls.asks[0]).toContain('Create 1 YS student and link them to Elvanto?');
    expect(h.calls.posts).toHaveLength(0); // Cancel: nothing sent
    h.answers.push(true);
    await h.fns._lkAdmCreate(`${P(450)}`);
    expect(h.calls.posts[0]).toMatchObject({ p: '/link/admin/create-students', b: { personIds: [P(450)] } });
    expect(h.calls.toasts.pop()).toBe('Created and linked 1. 1 skipped: same name twice in Elvanto.');
  });
  it('round 2026-10-21 (L3 r4): Create all sends batches of 10, sums them, stops on an error, and ignores a second tap', async () => {
    let n = 0, release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const h = makeEnv({ role: 'admin', post: async (_p: string, b: any) => {
      n++; if (n === 1) await gate; if (n === 3) throw new Error('Server busy');
      return { created: b.personIds.length, skipped: {} }; } });
    h.get().LINK.adm.roster = Array.from({ length: 25 }, (_, i) =>
      ({ personId: P(500 + i), name: 'N ' + i, grade: 8, kind: 'student', match: 'none', studentId: null, candidates: [], create: true }));
    h.answers.push(true);
    const first = h.fns._lkAdmCreate(null);
    await vi.waitFor(() => expect(h.calls.posts).toHaveLength(1));
    expect(h.get().LINK.adm.creating).toBe(true);
    expect(h.fns._lkAdmMatchHtml()).toContain('disabled'); // buttons off while it runs
    await h.fns._lkAdmCreate(null);                      // a second tap: nothing asked, nothing sent
    expect(h.calls.asks).toHaveLength(1);
    release();
    await first;
    expect(h.calls.posts.map((x: any) => x.b.personIds.length)).toEqual([10, 10, 5].slice(0, 3));
    expect(h.calls.toasts.pop()).toBe('Created and linked 20. Server busy');
    expect(h.get().LINK.adm.creating).toBe(false);
  });
  it('round 2026-10-21 (L3 r4): a row with no gender or no grade says why there is no Create', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.adm.roster = [
      { personId: P(530), name: 'No Gen', grade: 8, kind: 'student', match: 'none', studentId: null, candidates: [], noCreate: 'noGender' },
      { personId: P(531), name: 'No Grade', grade: null, kind: 'student', match: 'none', studentId: null, candidates: [], noCreate: 'badData' },
    ];
    const out = strip(h.fns._lkAdmMatchHtml());
    expect(out).toContain('No gender in Elvanto. Set it there, or use Match.');
    expect(out).toContain('No grade or name in Elvanto. Set it there, or use Match.');
    expect(out).not.toContain('Create all');
  });
  it('round 2026-10-21 (L3): each tab says why a person is listed (Unmatched = no YS student of that name yet)', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.adm.roster = [
      { personId: P(420), name: 'Kay Bee', grade: 12, kind: 'student', match: 'none', studentId: null, candidates: [] },
      { personId: P(421), name: 'Two Same', grade: 9, kind: 'student', match: 'ambiguous', studentId: null, candidates: [] },
    ];
    expect(strip(h.fns._lkAdmMatchHtml())).toContain('In Elvanto, but not paired with a YS student.');
    h.get().LINK.adm.mf = 'ambiguous';
    expect(strip(h.fns._lkAdmMatchHtml())).toContain('More than one person has this name. Pick the right one.');
    h.get().LINK.adm.mf = 'manual';
    expect(strip(h.fns._lkAdmMatchHtml())).toContain('Pairs you set by hand');
  });
});

describe('T-17 / X14 outside the window a pending row says when it goes', () => {
  const st = (c: any) => ({ console: { lastSeenAt: '2026-10-16T06:12:00.000Z', online: true, inWindow: false, pollSeconds: 900,
    capabilities: null, consoles: 1, ...c }, mirrors: {} });
  it('online, outside the window: "Usually under a minute. (fix16 GAP-3)"; inside the window or offline: not', () => {
    const h = makeEnv();
    h.get().LINK.status = st({});
    expect(h.fns._lkStatusText({ status: 'pending', reason: null })).toBe('Waiting for Elvanto. Usually under a minute.');
    expect(h.fns._lkStatusText({ status: 'pending', reason: 'awaiting-approval' })).toBe('Waiting for the new-person form to be approved.');
    h.get().LINK.status = st({ inWindow: true });
    expect(h.fns._lkStatusText({ status: 'pending', reason: null })).toBe('Waiting for Elvanto.');
    h.get().LINK.status = st({ online: false });
    expect(h.fns._lkStatusText({ status: 'pending', reason: null }, '4:12 pm')).toBe('Waiting for Elvanto. Elvanto last reached 4:12 pm');
  });
});

describe('T-46 UI minors', () => {
  it('APP-57/58/59: the retry pill, the tick rows and the Checked in summary are 40 px touch targets', () => {
    expect(html).toMatch(/\.lk-pill\.bad\{[^}]*min-height:40px;padding:8px 14px/);
    expect(html).toMatch(/\.lk-chk\{[^}]*min-height:40px/);
    expect(html).toMatch(/\.lk-done summary\{[^}]*min-height:40px/);
  });
  it('APP-61/62: the Activity date row wraps; the door search and grade stay on screen while scrolling', () => {
    expect(html).toMatch(/\.lk-filters\.wrap\{flex-wrap:wrap\}/);
    expect(extractFn(html, '_lkAdmLogHtml')).toContain('<div class="lk-filters wrap"><input type="date"');
    expect(html).toMatch(/\.lk-sticky\{position:sticky;top:var\(--hdr-h,0px\)/);
    expect(extractFn(html, '_lkPaintDoor')).toContain('<div class="lk-sticky">');
    expect(extractFn(html, '_positionNprog')).toContain("setProperty('--hdr-h'");
  });
  it('APP-63: the admin page words modes, statuses, lists and outcomes (no raw codes)', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.status = { console: { lastSeenAt: '2026-10-16T08:00:00.000Z', online: true, inWindow: true, pollSeconds: 60,
      capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'off', firstTimerCheckIn: 'live' }, consoles: 1 },
      mirrors: { roster: { takenAt: null, ageSeconds: 120 } } };
    h.get().LINK.adm = h.fns._lkAdmFresh();
    h.get().LINK.adm.acts = [{ id: P(1), type: 'checkIn', status: 'pending' }, { id: P(2), type: 'checkIn', status: 'claimed' }, { id: P(3), type: 'checkIn', status: 'sent' }];
    const out = strip(h.fns._lkAdmStatusHtml());
    for (const w of ['Live', 'Off', 'People list', 'Waiting', 'Sending', 'Saved']) expect(out).toContain(w);
    for (const raw of ['shadow', 'locked', 'Mirror: roster', 'pending', 'claimed']) expect(out).not.toContain(raw);
    const row = (o: string) => strip(h.fns._lkLogRowHtml({ id: P(9), at: '2026-10-16T08:31:02.120Z', userId: 'u1', login: 'g', deviceId: 'd', deviceLabel: 'p',
      event: 'checkIn', leaderId: null, leaderName: null, prevLeaderId: null, prevLeaderName: null, targetKind: 'person', targetId: null, targetName: 'Ava', outboxId: null, outcome: o }));
    expect(row('saved')).toContain('Saved');
    expect(row('replay')).toContain('Already sent');
    expect(row('refused:LINK_ID_REUSED')).toContain('Refused: id used for another action');
    expect(row('refused:LINK_ID_REUSED')).not.toContain('LINK_ID_REUSED');
    expect(row('refused:SOMETHING_NEW')).toContain('Refused: SOMETHING_NEW');
  });
  it('APP-64: the activity Export button has no upload icon', () => {
    expect(extractFn(html, '_lkAdmLogHtml')).not.toContain("icS('upload')");
  });
  it('APP-65: "Who are you?" has a sticky Cancel, and a name filter when over 12 leaders', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: 'L' + i, fullName: (i === 3 ? 'Zed <b>Z</b>' : 'Leader ' + i), active: true }));
    const h = makeEnv();
    h.get().LINK.ldrs = many;
    h.get().LINK.iamPick = new Set(many.map((l) => l.id));
    h.fns._lkIamPick(() => {});
    const m = h.calls.modals[0]!;
    expect(m).toContain('<div class="bus-sheet-actions"><button type="button" class="btn btn-secondary btn-full" onclick="closeModal()">Cancel</button></div>');
    expect(m).toContain('oninput="_lkIamFilter(this.value)"');
    expect(h.fns._lkIamListHtml('zed')).toContain('Zed &lt;b&gt;Z&lt;/b&gt;');
    expect(h.fns._lkIamListHtml('zed')).not.toContain('Leader 1');
    const k = makeEnv();
    k.get().LINK.ldrs = many.slice(0, 5);
    k.fns._lkIamPick(() => {});
    expect(k.calls.modals[0]).not.toContain('_lkIamFilter');
  });
  it('APP-66: the Complete sheet keeps its buttons outside #lk-fs (sticky, full width)', () => {
    expect(extractFn(html, '_lkStepHtml')).not.toContain('bus-sheet-actions');
    expect(extractFn(html, '_lkOpenStep')).toContain('modal(`<div id="lk-fs">${_lkStepHtml()}</div>${_lkStepActions()}`');
    expect(extractFn(html, '_lkStepActions')).toContain('bus-sheet-actions');
  });
  it('APP-67: the "already a report" warning has an Edit the last report button when it can be edited', () => {
    const f = extractFn(html, '_lkFormHtml');
    expect(f).toContain("onclick=\"_lkEditReport('${esc(last.reportId)}')\">Edit that report</button>");
  });
  it('APP-68: group names drop the prefix; flow rows show a chevron; ticks are a plain tick; the Complete line', () => {
    expect(extractFn(html, '_lkGroupsHtml')).toContain('lgDisplayName(g.name)');
    expect(extractFn(html, '_lkGroupHtml')).toContain('lgDisplayName(g.name)');
    expect(extractFn(html, '_lkFormHtml')).toContain('lgDisplayName(g.name)');
    expect(extractFn(html, '_lkFlowRowHtml')).toContain("icS('chevr')");
    expect(html).toMatch(/^  tick: +'<polyline points="20 6 9 17 4 12"\/>',/m);
    expect(extractFn(html, '_lkLeadersHtml')).toContain("icS('tick')");
    expect(extractFn(html, '_lkStepHtml')).not.toContain('Completing may send');
  });
  it('APP-69: Send waits for the leaders list before deciding the host; the loader keeps one list', async () => {
    expect(extractFn(html, 'nySend')).toMatch(/if \(!send && !p\.host && getMyLeaderId\(\) && !LINK\.ldrs\) \{[\s\S]*?await _lkLoadLeaders\(\);[\s\S]*?p\.host = _nyHost\(\);/); // fix16 F-06 holds the send flag
    const h = makeEnv();
    expect(await h.fns._lkLoadLeaders()).toEqual([]); // the stub API.get rejects: an empty list, nothing kept
    expect(h.get().LINK.ldrs).toBeNull();
    h.get().LINK.ldrs = [{ id: 'L1', fullName: 'A' }];
    expect(await h.fns._lkLoadLeaders()).toEqual([{ id: 'L1', fullName: 'A' }]);
  });
});

describe('incident 18 Oct: no-room refusal text', () => {
  it('does not blame Elvanto setup', () => {
    const h = makeEnv();
    door(h, [{ personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, action: { id: P(5), type: 'checkIn', status: 'refused', reason: 'no-room' }, mine: false }]);
    expect(strip(h.fns._lkRowHtml(h.get().LINK.people[SVC.serviceTimeId].people[0]))).toContain("No check-in room found for this person.");
  });
});
