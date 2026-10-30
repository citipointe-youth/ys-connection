// fix16 lane E (Lifegroups): F-02(b), F-03, F-25, F-38, F-40(b), F-48(d), F-49, GAP-4. Harness copied from link.spa.test.ts
// (no lane may edit a shared test file), with the picker functions added.
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
  '_structure', 'gradeBands', '_juniorMin', '_ikModuleOn', '_lkYpAdd', '_lkYpSet', '_lkYouthFilter', '_lkLoadGroups', '_lkRfBack', '_lkDraftKey', '_lkDraftGet', '_lkDraftDrop'];

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

describe('F-02(b) Add student picker: one add per tap', () => {
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
  it('a second tap within 600 ms (on any row) queues nothing', () => {
    vi.useFakeTimers();
    const h = pick();
    h.fns._lkYpAdd(P(70));
    vi.advanceTimersByTime(150);
    h.fns._lkYpAdd(P(71)); // the next row slid under the finger
    h.fns._lkYpAdd(P(70));
    expect(adds(h)).toHaveLength(1);
    expect(adds(h)[0].payload.personId).toBe(P(70));
    vi.advanceTimersByTime(1000); // B24: the tap must land >= 400 ms after the repaint that ends the 600 ms hold
    h.fns._lkYpAdd(P(71));
    expect(adds(h)).toHaveLength(2);
  });
  it('the tapped row stays in place greyed "Adding…" with no onclick, then leaves after 600 ms', () => {
    vi.useFakeTimers();
    const h = pick();
    h.fns._lkYpAdd(P(70));
    const el = h.calls.els['lk-yp-list'];
    expect(strip(el.innerHTML)).toContain('Tom LDummytonAdding…');
    expect(el.innerHTML).not.toContain(`_lkYpAdd('${P(70)}')`);
    expect(el.innerHTML.indexOf('Tom LDummyton')).toBeLessThan(el.innerHTML.indexOf('Tom Other'));
    vi.advanceTimersByTime(650);
    expect(el.innerHTML).not.toContain('Tom LDummyton');
    expect(el.innerHTML).toContain('Tom Other');
  });
});

describe('F-03 a date that already has a report blocks Send and offers Edit', () => {
  it('Add report on a taken date: the block, an Edit button, Send disabled, nothing queued', () => {
    const h = setup();
    h.fns._lkAddReport('2026-10-12'); // the week of Tue 13 Oct, which has a report
    const rf = h.get().LINK.rf;
    expect(rf.date).toBe('2026-10-13');
    const form = h.fns._lkFormHtml();
    expect(strip(form)).toContain("There's already a report for that date. Edit it.");
    expect(strip(form)).not.toContain('You can still add another');
    expect(form).toContain(`_lkEditReport('${G(9)}')`);
    expect(form).toMatch(/disabled onclick="_lkReportSend\(\)"/);
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()).toHaveLength(0);
  });
  it('a free date sends', () => {
    const h = setup();
    h.fns._lkAddReport('2026-10-05');
    h.fns._lkRfDate('2026-10-06');
    expect(h.fns._lkFormHtml()).not.toMatch(/disabled onclick="_lkReportSend\(\)"/);
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()).toHaveLength(1);
  });
  it('a report-exists refusal the console gave after the batch stays on the group card', async () => {
    const id = '20000000-0000-4000-8000-000000000001';
    const h = setup('L1', {}, { fresh: (p: string) => p.startsWith('/link/lifegroups') ? Promise.resolve({ groups: [grp()] })
      : p.startsWith('/link/actions?ids=' + id) ? Promise.resolve([{ id, type: 'submitReport', status: 'refused', reason: 'report-exists' }])
        : Promise.reject(new Error('no')) });
    const L = h.get().LINK;
    L.gres = { [G(1)]: { id, type: 'submitReport', status: 'pending', reason: null } };
    expect(await h.fns._lkLoadGroups(true)).toBe(true);
    expect(L.gres[G(1)]).toMatchObject({ status: 'refused', reason: 'report-exists' });
    expect(strip(h.fns._lkGroupHtml(L.groups[0]))).toContain("There's already a report for that date. Edit it.");
    expect(await h.fns._lkLoadGroups(true)).toBe(true); // a later reload keeps it
    expect(L.gres[G(1)].status).toBe('refused');
  });
  it('a pending row that went through is dropped (no stale line)', async () => {
    const id = '20000000-0000-4000-8000-000000000002';
    const h = setup('L1', {}, { fresh: (p: string) => p.startsWith('/link/lifegroups') ? Promise.resolve({ groups: [grp()] })
      : Promise.resolve([{ id, type: 'submitReport', status: 'sent', reason: null }]) });
    const L = h.get().LINK;
    L.gres = { [G(1)]: { id, type: 'submitReport', status: 'pending', reason: null } };
    await h.fns._lkLoadGroups(true);
    expect(L.gres[G(1)]).toBeUndefined();
  });
});

describe('F-25 report form: default service, a draft per group and date, Discard asks', () => {
  it('operator 2026-10-17: a new form starts on No service on every date, even a day with a default service', () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16'); // RSVC marks P(50) as this day's default
    expect(h.get().LINK.rf.svc).toBe('none');
    expect(h.fns._lkFormHtml()).toContain('<option value="none" selected>No service</option>');
    h.fns._lkRfDate('2026-10-13'); // also a day with a default (P(52))
    expect(h.get().LINK.rf.svc).toBe('none');
  });
  it('a picked service survives a date change', () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16');
    h.fns._lkRfSvc(P(52));
    h.fns._lkRfDate('2026-10-14');
    expect(h.get().LINK.rf.svc).toBe(P(52));
  });
  it('Group did not meet on then off comes back on No service, not Pick a service', () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16');
    h.fns._lkRfDnm(true);
    expect(h.get().LINK.rf.svc).toBe('');
    h.fns._lkRfDnm(false);
    expect(h.get().LINK.rf.svc).toBe('none');
    expect(h.fns._lkFormHtml()).not.toContain('Pick a service</option>');
  });
  it('an untouched new report queues serviceTimeId null', () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16');
    h.fns._lkRfTick(P(61));
    h.fns._lkReportSend();
    expect(h.fns._lkQGet()[0].payload.serviceTimeId).toBeNull();
  });
  it('Edit keeps the saved service (a real one, and none)', () => {
    const a = setup('L1', { lastReport: { ...grp().lastReport, serviceTimeId: P(52) } });
    a.fns._lkEditReport(G(9));
    expect(a.get().LINK.rf.svc).toBe(P(52));
    const b = setup(); // grp().lastReport.serviceTimeId is null
    b.fns._lkEditReport(G(9));
    expect(b.get().LINK.rf.svc).toBe('none');
  });
  it('a back gesture keeps the draft: reopening the same group and date restores the ticks and note', () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16');
    h.fns._lkRfTick(P(61)); h.fns._lkRfGuests('3');
    h.get().LINK.rf = null; // the header arrow / Android back (navBack) drops the form silently
    h.fns._lkNewReport('2026-10-16');
    expect(h.get().LINK.rf.ticks).toEqual({ [P(61)]: true });
    expect(h.get().LINK.rf.guests).toBe(3);
    h.fns._lkReportSend(); // a sent report leaves no draft
    h.fns._lkNewReport('2026-10-16');
    expect(h.get().LINK.rf.ticks).toEqual({});
  });
  it('Cancel with a dirty form asks "Discard report?"; Keep editing stays, Discard drops the draft', async () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16');
    h.fns._lkRfTick(P(61));
    h.answers.push(false);
    await h.fns._lkRfBack();
    expect(h.calls.asks[0]).toContain('| Discard report | Keep editing');
    expect(h.calls.gos).not.toContain('back');
    h.answers.push(true);
    await h.fns._lkRfBack();
    expect(h.calls.gos).toContain('back');
    h.get().LINK.rf = null;
    h.fns._lkNewReport('2026-10-16');
    expect(h.get().LINK.rf.ticks).toEqual({});
  });
  it('Cancel on an untouched form goes straight back', async () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16');
    await h.fns._lkRfBack();
    expect(h.calls.asks).toHaveLength(0);
    expect(h.calls.gos).toContain('back');
    expect(h.fns._lkFormHtml()).toContain('onclick="_lkRfBack()"');
  });
});

describe('F-38 member remove: Cancel remove while it can be cancelled, Add back once sent', () => {
  const view = (status: string) => ({ groupId: G(1), canEdit: true, members: [{ personId: P(70), name: 'Tom LDummyton', leader: false, grade: 11, studentId: null }],
    changes: [{ id: 'x1', type: 'removeGroupMember', personId: P(70), name: 'Tom LDummyton', status, reason: null }] });
  const label = (status: string) => {
    const h = setup();
    const L = h.get().LINK;
    L.gm[G(1)] = view(status); L.gmOpen[G(1)] = true;
    const out = h.fns._lkMembersHtml(L.groups[0]);
    const m = out.match(/_lkMemKeep\([^)]*\)">([^<]*)<\/button>/);
    return m ? m[1] : null;
  };
  it('labels per state', () => {
    expect(label('pending')).toBe('Cancel remove');
    expect(label('claimed')).toBeNull();
    expect(label('sent')).toBe('Add back');
    expect(label('unclear')).toBe('Add back');
  });
  it('a remove still on this phone says Cancel remove', () => {
    const h = setup();
    const L = h.get().LINK;
    L.gm[G(1)] = { ...view('sent'), changes: [] }; L.gmOpen[G(1)] = true;
    h.fns._lkQSet([{ kind: 'action', id: 'q1', type: 'removeGroupMember', payload: { groupId: G(1), personId: P(70) }, _n: 'Tom LDummyton' }]);
    expect(h.fns._lkMembersHtml(L.groups[0])).toMatch(/_lkMemKeep\([^)]*\)">Cancel remove</);
  });
});

describe('F-40(b) report tick rows are checkboxes', () => {
  it('role=checkbox, aria-checked follows the tick, focusable, Space/Enter handler', () => {
    const h = setup();
    h.fns._lkNewReport('2026-10-16');
    h.fns._lkRfTick(P(61));
    const form = h.fns._lkFormHtml();
    expect(form).toContain(`role="checkbox" aria-checked="true" tabindex="0" onclick="_lkRfTick('${P(61)}')"`);
    expect(form).toContain(`role="checkbox" aria-checked="false" tabindex="0" onclick="_lkRfTick('${P(63)}')"`);
    expect(form).toContain(`onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();_lkRfTick('${P(61)}')}"`);
  });
});

describe('F-48(d) category chips never wrap', () => {
  it('the chips sit in the Flows no-wrap row (.lk-ff), purple for Mixed', () => {
    const h = setup();
    h.get().LINK.groups.push({ ...grp(), groupId: G(2), name: 'City of Logan Thursday', grade: null, gender: null });
    const html = h.fns._lkGroupsHtml();
    expect(html).toContain('class="filter-row lk-ff lk-cf"');
    expect(html).toContain('class="fc lk-ff-mix"'); expect(html).toContain('var(--mix-light)');
    expect(loadIndexHtml()).toMatch(/\.lk-ff \.fc\{[^}]*white-space:nowrap/);
  });
});

describe('F-49 report count label', () => {
  it('says "Students here (N)" (ticked members, guests apart)', () => {
    const h = setup();
    const g = h.get().LINK.groups[0];
    const out = strip(h.fns._lkReportHtml(g, g.lastReport));
    expect(out).toContain('Students here (1)Ava Example');
    expect(out).toContain('Guests2');
  });
});

describe('GAP-4 fewer taps: newest week with no report, Yr chip opens a lone group', () => {
  it('the group page offers a jump to the newest week with no report', () => {
    const h = setup(); // today Fri 16 Oct; this week's Tue 13 Oct has a report, the week of 6 Oct has none
    const g = h.get().LINK.groups[0];
    const page = h.fns._lkGroupHtml(g);
    expect(page).toContain('onclick="_lkWeekGo(1)">Go to the newest week with no report');
    h.get().LINK.gwk = 1;
    expect(h.fns._lkGroupHtml(g)).not.toContain('Go to the newest week'); // already there
  });
  it('no jump when every week in reach has a report', () => {
    const h = setup();
    const g = h.get().LINK.groups[0];
    g.history = ['2026-10-06', '2026-09-29', '2026-09-22', '2026-09-15', '2026-09-08', '2026-09-01', '2026-08-25'].map((date, i) => ({ ...g.lastReport, reportId: G(20 + i), date })); // all 8 weeks (T3, 2026-10-21)
    expect(h.fns._lkGroupHtml(g)).not.toContain('Go to the newest week');
  });
  it('a category chip only filters the list, whatever its count (one group does not open)', () => {
    const h = setup();
    const L = h.get().LINK;
    L.groups.push({ ...grp(), groupId: G(2), name: 'Yr 12 Boys', grade: 12, gender: 'male' }, { ...grp(), groupId: G(3), name: 'Yr 9 Boys', grade: 9, gender: 'male' },
      { ...grp(), groupId: G(4), name: 'Yr 8 Boys', grade: 8, gender: 'male' }, { ...grp(), groupId: G(5), name: 'City of Logan', grade: null, gender: null });
    L.gid = null;
    h.calls.els['lk-glist'] = { innerHTML: '' };
    h.fns._lkCatFilter('sg'); // one group
    expect(L.gid).toBeNull();
    expect(h.calls.els['lk-glist'].innerHTML).toContain('Yr 12 Boys');
    h.fns._lkCatFilter('jg'); // two groups
    expect(L.gid).toBeNull();
    h.fns._lkCatFilter('mx'); // one Mixed group
    expect(L.gid).toBeNull();
    expect(h.calls.els['lk-glist'].innerHTML).toContain('City of Logan');
  });
});
