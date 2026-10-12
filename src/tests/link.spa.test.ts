// Elvanto link SPA (plan Tasks F1.1–F1.4). Extract-and-run: the REAL functions from public/index.html run against
// small stubs (localStorage, API, modal). No server: /link routes are stubbed with the spec's response shapes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['esc', '_nyModeOf', '_nyMode', '_nyOn', '_linkOn', 'moreItems', 'setMyLeaderId',
  '_lkFresh', '_lkTime', '_lkDay', '_lkSvcLabel', '_lkPracticeLine', '_lkStatusText', '_lkStatusTone', '_lkCap', '_lkCapOff', '_lkLastSeen',
  '_lkBanner', '_lkKey', '_lkQGet', '_lkQSet', '_lkUuid', '_lkPush', '_lkSchedule', '_lkTakeBack', '_lkQueuedIdx', '_lkMerge', '_lkApply',
  '_lkFlush', '_lkSwitchedOff', '_lkFailed', '_lkRetry', '_lkResults', '_lkPill', '_lkLogoutGuard', '_lkClear', '_lkSoftReset', '_lkOnPage',
  '_lkRefreshView', '_lkTop', '_lkSvc', '_lkFilter', '_lkListHtml', '_lkRowHtml', '_lkCheck', '_lkUndo',
  '_lkLeadersView', '_lkLeaderState', '_lkTickedCount', '_lkLeadersHtml', '_lkLeadersFoot', '_lkLeadersDraw',
  '_lkTickLeader', '_lkTickAll', '_lkLeadersSubmit', '_lkOpenLeaders', '_lkTickStop', '_lkStatusHtml',
  '_lkSwitchGuard', '_lkSwitchLeader', '_lkIamPick', '_lkIamUse', '_lkMyName', '_lkAddDays', '_lkHHMM', '_lkDefaultSvcFor',
  '_lkWeekChip', '_lkGroup', '_lkGroupAct', '_lkGroupsHtml', '_lkSvcName', '_lkLastHtml', '_lkGroupHtml', '_lkNoteCount',
  '_lkFormHtml', '_lkPaintGroups', '_lkOpenGroup', '_lkGroupsBack', '_lkNewReport', '_lkEditReport', '_lkFormOpen',
  '_lkRfDate', '_lkRfDnm', '_lkRfTick', '_lkRfGuests', '_lkRfSvc', '_lkRfNote', '_lkReportSend', '_lkReportUndo', '_lkReportCancel',
  '_lkTapToast', '_lkToastDraw', '_lkToastUndo', '_lkSvcDay', '_lkNotToday', '_lkDayCheck', '_lkNoTonight', '_lkDayOk', '_lkTakeServices', '_lkPickService', '_lkPickHtml', '_lkPickFoot',   '_lkToday', '_lkFlowRow', '_lkFlowAct', '_lkFlowsHtml', '_lkStepHtml', '_lkOpenStep', '_lkStepDraw', '_lkStepNote', '_lkStepSend',
  '_lkStepUndo', '_lkStepCancel', '_lkPaintFlows',
  '_lkFirstTimerDecision', '_lkFirstTimerPayload', '_nyLinkHtml', '_lkFirstTimerAfter',
  'renderLink', '_lkTickStart', '_lkStatusLoad', '_lkAdmFresh', '_lkLastFriday', '_lkAt', '_lkLogWho', '_lkLogRowHtml', '_lkLogFile', '_lkLogAoa',
  '_lkLogExport', '_lkEvents', '_lkVerb', '_lkAdmStatusHtml', '_lkAdmMatchHtml', '_lkAdmShadowHtml', '_lkAdmLogListHtml', '_lkAdmLogHtml', '_lkAdminHtml'];

const SVC = { serviceTimeId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222',
  name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16' };
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BODY = FNS.map((n) => extractFn(loadIndexHtml(), n)).join('\n');

interface Env { storage: Map<string, string>; failStorage?: boolean; post?: (path: string, body: any, ms?: number) => Promise<any>;
  role?: string; mode?: string; leaderId?: string | null; }

function makeEnv(e: Partial<Env> = {}) {
  const env: Env = { storage: e.storage ?? new Map(), ...e } as Env;
  const calls = { posts: [] as any[], toasts: [] as string[], modals: [] as string[], closed: 0, asks: [] as string[], apps: [] as string[], gos: [] as string[] };
  const ls = {
    getItem: (k: string) => { if (env.failStorage) throw new Error('blocked'); return env.storage.has(k) ? env.storage.get(k)! : null; },
    setItem: (k: string, v: string) => { if (env.failStorage) throw new Error('blocked'); env.storage.set(k, String(v)); },
    removeItem: (k: string) => { if (env.failStorage) throw new Error('blocked'); env.storage.delete(k); },
  };
  const prelude = `
    const S = { user: { id: 'u1', role: ${JSON.stringify(env.role ?? 'grade')} }, page: 'home',
      settings: { ministryConfig: { modules: { newYouthForms: ${JSON.stringify(env.mode ?? 'on')} } } } };
    let LINK = _lkFresh();
    const LK_DOOR_TYPES = ['checkIn', 'checkOut'];
    const localStorage = __ls;
    const navigator = { userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' };
    const document = { getElementById: () => null, visibilityState: 'visible' };
    const API = { post: (p, b, ms) => __post(p, b, ms), fresh: () => Promise.reject(new Error('no')), get: () => Promise.reject(new Error('no')) };
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
  it('_linkOn uses the New person rule: off nobody, shadow admin only, on everyone', () => {
    for (const role of ['admin', 'director', 'quad', 'grade', 'leader']) {
      expect(makeEnv({ role, mode: 'off' }).fns._linkOn()).toBe(false);
      expect(makeEnv({ role, mode: 'shadow' }).fns._linkOn()).toBe(role === 'admin');
      expect(makeEnv({ role, mode: 'on' }).fns._linkOn()).toBe(true);
    }
  });
  it('moreItems per role and mode', () => {
    const ids = (role: string, mode: string) => makeEnv({ role, mode }).fns.moreItems().map((m: any) => m.id).filter((id: string) => id.startsWith('link-'));
    expect(ids('admin', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows', 'link-admin']);
    expect(ids('director', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows', 'link-admin']);
    expect(ids('quad', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows']);
    expect(ids('grade', 'on')).toEqual(['link-checkin', 'link-groups', 'link-flows']);
    expect(ids('leader', 'on')).toEqual(['link-checkin']);
    expect(ids('admin', 'shadow')).toEqual(['link-checkin', 'link-groups', 'link-flows', 'link-admin']);
    for (const role of ['director', 'quad', 'grade', 'leader']) expect(ids(role, 'shadow')).toEqual([]);
    for (const role of ['admin', 'director', 'quad', 'grade', 'leader']) expect(ids(role, 'off')).toEqual([]);
  });
  it('Youth Setup control is relabelled "Elvanto features" with the spec help text; key unchanged', () => {
    expect(html).toContain('<label class="fl" for="setup-ny">Elvanto features ${helpTip("Turns on the screens that send to Elvanto: New person, Check-in, Lifegroup report and Flow steps. Shadow mode shows them to the admin login only, for testing. Off by default.")}');
    expect(html).toContain("_setupSet('modules.newYouthForms', this.value)");
  });
  it('link pages are routed, and a junior leader may open the door screen only', () => {
    expect(html).toContain("else if (String(p).indexOf('link-') === 0) await renderLink(p);");
    expect(html).toContain("['home','my-students','at-risk','prayers','birthdays','bus','new-youth'].includes(p) && p !== 'link-checkin'");
  });
});

describe('F1.1 _lkStatusText (contract §5.3 / §5.4 word for word)', () => {
  const t = makeEnv().fns._lkStatusText;
  it('every status', () => {
    expect(t({ status: 'pending', reason: null })).toBe('Waiting for the console.');
    expect(t({ status: 'pending', reason: null }, '7:02 pm')).toBe('Waiting for the console. Console last seen 7:02 pm');
    expect(t({ status: 'pending', reason: 'awaiting-approval' })).toBe('Waiting for the new-person form to be approved.');
    expect(t({ status: 'claimed' })).toBe('Sending to Elvanto…');
    expect(t({ status: 'sent', reason: null, resultAt: '2026-10-16T09:02:00.000Z' })).toBe('In Elvanto 7:02 pm');
    expect(t({ status: 'sent', reason: 'already' })).toBe('Already in Elvanto');
    expect(t({ status: 'shadowed' })).toBe('Practice mode: not sent to Elvanto. Check in the usual way.');
    expect(t({ status: 'unclear', reason: 'lease-lost' })).toBe('Not sure it saved. The admin is checking Elvanto.');
    expect(t({ status: 'cancelled' })).toBe('Cancelled.');
    expect(t({ status: 'queued' })).toBe('Waiting to send.');
    expect(t({ status: 'mirror' })).toBe('In Elvanto.');
  });
  it('every refusal reason', () => {
    const lines: Record<string, string> = {
      'locked': "This isn't connected yet. Do it in Elvanto.",
      'no-room': 'No room for this person. Check in on the kiosk.',
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
      'step-moved': 'This step changed in Elvanto. Do it there.',
      'assignee-needed': 'This step changed in Elvanto. Do it there.',
      'ambiguous-first-timer': 'Two new people have this name. Check in on the kiosk.',
      'too-old': 'Too late to send. Do it in Elvanto.',
      'not-landed': "It didn't save. Do it in Elvanto.",
      'console-cannot-read': "The console couldn't do this. Do it in Elvanto.",
      'unknown': "The console couldn't do this. Do it in Elvanto.",
      'lease-lost': 'Not sure it saved. The admin is checking Elvanto.',
      'note-unreadable': "This note couldn't be read. Do it in Elvanto.",
    };
    for (const [reason, line] of Object.entries(lines)) expect(t({ status: 'refused', reason })).toBe(line);
    expect(t({ status: 'refused', reason: null, message: 'Do this in Elvanto for now.' })).toBe('Do this in Elvanto for now.');
  });
});

describe('A3 / X9 lines by action type', () => {
  const t = makeEnv().fns._lkStatusText;
  it('shadowed: one line per type', () => {
    expect(t({ status: 'shadowed', type: 'checkIn' })).toBe('Practice mode: not sent to Elvanto. Check in the usual way.');
    expect(t({ status: 'shadowed', type: 'firstTimerCheckIn' })).toBe('Practice mode: not sent to Elvanto. Check in the usual way.');
    expect(t({ status: 'shadowed', type: 'checkOut' })).toBe('Practice mode: not sent to Elvanto. Check out the usual way.');
    for (const type of ['submitReport', 'editReport', 'completeStep']) {
      expect(t({ status: 'shadowed', type })).toBe('Practice mode: not sent to Elvanto. Do it in Elvanto as usual.');
    }
  });
  it('check-out no-room and flow-step already', () => {
    expect(t({ status: 'refused', type: 'checkOut', reason: 'no-room' })).toBe("They aren't in a room in Elvanto. Check them out in Elvanto.");
    expect(t({ status: 'refused', type: 'checkIn', reason: 'no-room' })).toBe('No room for this person. Check in on the kiosk.');
    expect(t({ status: 'sent', type: 'completeStep', reason: 'already' })).toBe("Done once already. If it's back on the list, do it in Elvanto.");
    expect(t({ status: 'sent', type: 'checkIn', reason: 'already' })).toBe('Already in Elvanto');
  });
  it('the practice banner picks the line by the screen types', () => {
    const st = (caps: any) => ({ console: { lastSeenAt: '2026-10-16T06:12:00.000Z', online: true, inWindow: true, pollSeconds: 60,
      capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', ...caps }, consoles: 1 }, mirrors: {} });
    const b = (types: string[], caps: any) => strip(makeEnv().fns._lkBanner(types, st(caps)));
    expect(b(['checkIn', 'checkOut'], { checkOut: 'shadow' })).toContain('Check out the usual way.');
    expect(b(['checkIn', 'checkOut'], { checkOut: 'shadow' })).not.toContain('Check in the usual way.');
    expect(b(['completeStep'], { completeStep: 'shadow' })).toContain('Practice mode: not sent to Elvanto. Do it in Elvanto as usual.');
    const both = b(['submitReport', 'editReport'], { submitReport: 'shadow', editReport: 'shadow' });
    expect(both.split('Do it in Elvanto as usual.').length).toBe(2); // one line, not two
  });
});

describe('F1.1 _lkBanner', () => {
  const st = (c: any) => ({ console: { lastSeenAt: '2026-10-16T06:12:00.000Z', online: true, inWindow: true, pollSeconds: 60,
    capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live' }, consoles: 1, ...c }, mirrors: {} });
  const caps = (x: any) => ({ checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', ...x });
  it('offline shows the last-seen time', () => {
    expect(strip(makeEnv().fns._lkBanner(['checkIn'], st({ online: false })))).toContain('The console was last seen 4:12 pm. Actions are queued, not in Elvanto yet. Use the kiosk too.');
  });
  it('practice mode, check-out locked, off hides', () => {
    const b = strip(makeEnv().fns._lkBanner(['checkIn', 'checkOut'], st({ capabilities: caps({ checkIn: 'shadow', checkOut: 'locked' }) })));
    expect(b).toContain('Practice mode: not sent to Elvanto. Check in the usual way.');
    expect(b).toContain("Check-out: this isn't connected yet. Do it in Elvanto.");
    expect(b).not.toContain('last seen');
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
  L.services = [SVC]; L.svc = SVC.serviceTimeId; L.people[SVC.serviceTimeId] = { people, leaders };
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
    expect(strip(row)).toContain('Do this in Elvanto for now.');
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
    expect(h.calls.toasts).toContain('Already sent. Do it in Elvanto.');
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
    expect(h.calls.asks[0]).toBe("1 check-in hasn't been sent yet. Send them now? | Send now | Stay");
    expect(h.calls.posts).toHaveLength(1);
  });
  it('Stay keeps the login', async () => {
    const h = makeEnv();
    h.fns._lkQSet([item]);
    h.answers.push(false);
    expect(await h.fns._lkLogoutGuard()).toBe(false);
    expect(h.calls.posts).toHaveLength(0);
  });
  it('a send that does not finish within 10 s offers "Log out anyway (they\'ll be lost)"', async () => {
    vi.useFakeTimers();
    const h = makeEnv({ post: () => new Promise(() => {}) });
    h.fns._lkQSet([item, item]);
    h.answers.push(true, true);
    const p = h.fns._lkLogoutGuard();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBe(true);
    expect(h.calls.asks[0]).toMatch(/^2 check-ins haven't been sent yet/);
    expect(h.calls.asks[1]).toBe("They could not be sent. | Log out anyway (they'll be lost) | Stay");
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
    { personId: P(1), name: 'Ava Example', grade: 7, leader: false, checkedIn: false, practice: false, action: null, mine: false },
    { personId: P(2), name: 'Dana Testleader', grade: null, leader: true, checkedIn: false, practice: false, action: null, mine: false },
    { personId: P(3), name: 'Ben <b>Sample</b>', grade: 9, leader: false, checkedIn: true, practice: false, action: { id: P(30), type: 'checkIn', status: 'pending', reason: null }, mine: true },
    { personId: P(4), name: 'Gus Notreal', grade: 11, leader: false, checkedIn: true, practice: true, action: { id: P(31), type: 'checkIn', status: 'shadowed', reason: null }, mine: false },
    { personId: P(5), name: 'Hana Invented', grade: 7, leader: false, checkedIn: true, practice: false, action: null, mine: false },
    { personId: P(6), name: 'Mary Jane Smith', grade: 10, leader: false, checkedIn: false, practice: false, action: null, mine: false },
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
  it('the grade select filters (All, 7–12, Leaders)', () => {
    const f = makeEnv().fns._lkFilter;
    expect(f(people, { search: '', grade: 'all' })).toHaveLength(6);
    expect(f(people, { search: '', grade: '7' }).map((p: any) => p.personId)).toEqual([P(1), P(5)]);
    expect(f(people, { search: '', grade: 'leaders' }).map((p: any) => p.personId)).toEqual([P(2)]);
    for (const g of ['7', '8', '9', '10', '11', '12']) expect(html).toContain(`['${g}', 'Grade ${g}']`);
    expect(html).toContain("['leaders', 'Leaders']");
  });
  it('summary reads "In N · Still to come M"', () => {
    const h = setup();
    expect(strip(h.fns._lkListHtml())).toContain('In 3 · Still to come 3');
    h.get().LINK.q.grade = '7';
    expect(strip(h.fns._lkListHtml())).toContain('In 1 · Still to come 1');
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
  it('practice rows show the practice line; a kiosk check-in reads "In Elvanto."', () => {
    const h = setup();
    expect(strip(h.fns._lkRowHtml(people[3]))).toContain('Practice mode: not sent to Elvanto. Check in the usual way.');
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
  it('one confirm before the first check-in to a service that is not today', async () => {
    const h = setupDay('2026-10-17T09:00:00.000Z'); // Saturday evening: Friday is not today
    h.answers.push(true);
    h.fns._lkCheck(P(1), 'checkIn');
    expect(h.calls.asks).toHaveLength(1);
    expect(h.calls.asks[0]).toContain('not today');
    expect(h.fns._lkQGet()).toHaveLength(0);
    await Promise.resolve(); await Promise.resolve();
    expect(h.fns._lkQGet()).toHaveLength(1);
    h.fns._lkCheck(P(1), 'checkIn'); // removes the queued one: no question
    h.fns._lkCheck(P(1), 'checkIn');
    expect(h.calls.asks).toHaveLength(1);
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
    expect(html).toMatch(/function _nyLinkLoad\(\) \{\r?\n  if \(!_linkOn\(\)\) return;\r?\n  _lkDayCheck\(\);/);
    expect(html).toMatch(/if \(_lkOnPage\(\)\) \{ if \(_lkDayCheck\(\) && S\.page === 'link-checkin'\) renderLinkCheckin\(\);/);
  });
  it('no service today: "Tonight\u2019s service is not here yet" line (kiosk)', () => {
    const h = setupDay('2026-10-17T09:00:00.000Z');
    expect(strip(h.fns._lkNoTonight())).toContain("Tonight's service isn't here yet. Use the kiosk.");
    const h2 = setupDay('2026-10-16T09:00:00.000Z');
    expect(h2.fns._lkNoTonight()).toBe('');
  });
});

// ── F1.4 leader quick check-in ──
describe('F1.4 leader sheet', () => {
  const leaders = [
    { leaderId: 'l3', name: 'Cal <i>Exampleleader</i>', personId: P(13), checkedIn: false, practice: false, action: null, mine: false },
    { leaderId: 'l1', name: 'Alex Testleader', personId: P(11), checkedIn: false, practice: false, action: null, mine: false },
    { leaderId: 'l2', name: 'Bea Sampleleader', personId: P(12), checkedIn: true, practice: false, action: { id: P(90), type: 'checkIn', status: 'sent', reason: null }, mine: false },
    { leaderId: 'l5', name: 'Eve Mockleader', personId: null, checkedIn: false, practice: false, action: null, mine: false },
  ];
  const setup = () => { const h = makeEnv({ leaderId: P(77) }); door(h, [], JSON.parse(JSON.stringify(leaders))); h.get().LINK.lq = {}; return h; };
  const rowsOf = (h: any) => h.fns._lkLeadersHtml().split('lk-lq-row').slice(1);
  it('B11 / APP-56: one line when there are unlinked leaders; none when all are linked', () => {
    const h = setup();
    expect(strip(h.fns._lkLeadersHtml())).toContain('Not linked: no Elvanto person has this exact name. Ask the admin to fix the name.');
    const h2 = makeEnv(); door(h2, [], [leaders[1]]); h2.get().LINK.lq = {};
    expect(strip(h2.fns._lkLeadersHtml())).not.toContain('Not linked:');
  });
  it('B11 / APP-56: the sheet opens with "Loading…" until the leader list is loaded; Submit stays disabled', () => {
    const h = makeEnv();
    door(h);
    delete h.get().LINK.people[SVC.serviceTimeId];
    h.fns._lkOpenLeaders();
    expect(h.calls.modals).toHaveLength(1);
    expect(strip(h.calls.modals[0]!)).toContain('Loading…');
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
    expect(h.fns._lkStatusHtml({ status: 'pending', reason: null })).toBe('Waiting for the console.');
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
    { serviceTimeId: P(50), serviceId: P(51), name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16' },
    { serviceTimeId: P(52), serviceId: P(53), name: 'Morning', startsAt: '2026-10-11T00:15:00.000Z', ymd: '2026-10-11' },
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
    L.rToday = '2026-10-16'; L.rServices = RSVC; L.ldrs = [{ id: 'L1', fullName: 'Cody <b>Cobb</b>', active: true }];
    L.groups = [grp(over)]; L.gid = G(1);
    return h;
  };
  it('the group list chip per thisWeek; "Can\'t read" is double-quoted in the source', () => {
    const want: Record<string, string> = { reported: 'Reported', 'did-not-meet': 'Did not meet', none: 'No report', later: 'Later', unreadable: "Can't read" };
    const f = makeEnv().fns;
    for (const [k, v] of Object.entries(want)) expect(strip(f._lkWeekChip(k))).toBe(v);
    expect(extractFn(html, '_lkWeekChip')).toContain(`"Can't read"`);
    const h = setup();
    const list = h.fns._lkGroupsHtml();
    expect(strip(list)).toContain('Reported');
    expect(list).toContain('Yr 9 &lt;i&gt;Girls&lt;/i&gt;');
    expect(list).not.toContain('<i>Girls');
  });
  it('the Last report card never shows notes', () => {
    const h = setup();
    const out = strip(h.fns._lkLastHtml(h.get().LINK.groups[0]));
    expect(out).not.toContain('SECRET');
    expect(out).toContain('Tue 6 Oct 18:30');
    expect(out).toContain('No service');
    expect(out).toContain('Guests2');
    expect(out).toContain('Here (2)Ava Example, Dana Testleader');
    const dnm = setup('L1', { lastReport: { ...grp().lastReport, didNotMeet: true, attendees: [] } });
    expect(strip(dnm.fns._lkLastHtml(dnm.get().LINK.groups[0]))).toContain('Group did not meet');
  });
  it('Edit is shown only when editable, else "Edit this report in Elvanto."', () => {
    const a = setup();
    const on = a.fns._lkLastHtml(a.get().LINK.groups[0]);
    expect(on).toContain('onclick="_lkEditReport()"');
    expect(on).not.toContain('Edit this report in Elvanto.');
    const b = setup('L1', { lastReport: { ...grp().lastReport, editable: false, blocked: 'multi-service' } });
    const off = b.fns._lkLastHtml(b.get().LINK.groups[0]);
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
    h.fns._lkNewReport();
    expect(h.get().LINK.rf).toBeNull();
    expect(h.calls.modals).toHaveLength(1);
    expect(h.calls.modals[0]).toContain('Who are you?');
    expect(h.calls.modals[0]).toContain('Cody &lt;b&gt;Cobb&lt;/b&gt;');
    expect(h.get().LINK.iamThen).toBeTypeOf('function');
    h.fns._lkEditReport();
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
    expect(h.get().LINK.rf).toMatchObject({ date: '2026-10-13', svc: '' }); // Tuesday: no default service
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
    h.fns._lkEditReport();
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
  it('the line "Elvanto will show: Self identified leader: <name>" is escaped', () => {
    const h = setup();
    h.fns._lkNewReport();
    const form = h.fns._lkFormHtml();
    expect(form).toContain('Elvanto will show: Self identified leader: Cody &lt;b&gt;Cobb&lt;/b&gt;');
    expect(form).not.toContain('<b>Cobb');
    expect(form).toContain('Ben &lt;b&gt;Sample&lt;/b&gt;');
  });
  it('service default per §2.3 and the older-than-7-days line', () => {
    const f = makeEnv().fns;
    expect(f._lkDefaultSvcFor('2026-10-16', RSVC)).toBe(P(50));
    expect(f._lkDefaultSvcFor('2026-10-11', RSVC)).toBe(P(52));
    expect(f._lkDefaultSvcFor('2026-10-13', RSVC)).toBeNull();
    expect(f._lkDefaultSvcFor('2026-10-16', [...RSVC, { ...RSVC[0], serviceTimeId: P(54) }])).toBeNull();
    const h = setup();
    h.fns._lkNewReport();
    h.fns._lkRfDate('2026-10-16');
    expect(h.get().LINK.rf.svc).toBe(P(50));
    expect(h.fns._lkFormHtml()).not.toContain('Older services are not listed.');
    h.fns._lkRfDate('2026-10-08');
    expect(h.fns._lkFormHtml()).toContain('Older services are not listed. Pick No service, or do it in Elvanto.');
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
  it('the page is routed; New report and Edit hide when the console has the type off', () => {
    expect(extractFn(html, 'renderLink')).toContain("if (p === 'link-groups') { await renderLinkGroups(); return; }");
    const h = setup();
    expect(h.fns._lkGroupHtml(h.get().LINK.groups[0])).toContain('_lkNewReport()');
    h.get().LINK.status = { console: { capabilities: { submitReport: 'off', editReport: 'off' } } };
    const out = h.fns._lkGroupHtml(h.get().LINK.groups[0]);
    expect(out).not.toContain('_lkNewReport()');
    expect(out).toContain('Edit this report in Elvanto.');
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
    L.today = '2026-10-16'; L.flows = rows; L.ldrs = [{ id: 'L1', fullName: 'Cody <b>Cobb</b>', active: true }];
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
    expect(rows[0]).not.toContain('_lkOpenStep');
    expect(strip(rows[0])).toContain('Waiting for the console.');
    expect(rows[1]).toContain(`_lkOpenStep('${F(2)}')`);
    h.fns._lkOpenStep(F(1));
    expect(h.calls.modals).toHaveLength(0);
    h.fns._lkQSet([{ kind: 'action', id: P(91), type: 'completeStep', payload: { rowId: F(2) }, note: null, leaderId: 'L1' }]);
    expect(h.fns._lkFlowsHtml()).not.toContain('_lkOpenStep');
    h.fns._lkOpenStep(F(2));
    expect(h.calls.modals).toHaveLength(0);
    // a refused or cancelled answer can be completed again
    const k = setup('L1', [row(1, { openAction: { id: P(92), type: 'completeStep', status: 'refused', reason: 'step-moved' } })]);
    expect(k.fns._lkFlowsHtml()).toContain('_lkOpenStep');
  });
  it('the sheet needs "I am": the picker opens first, then the sheet', () => {
    const h = setup(null);
    h.fns._lkOpenStep(F(2));
    expect(h.calls.modals).toHaveLength(1);
    expect(h.calls.modals[0]).toContain('Who are you?');
    expect(h.get().LINK.iamThen).toBeTypeOf('function');
    const k = setup('L1');
    k.fns._lkOpenStep(F(2));
    expect(k.calls.modals[0]).toContain('Complete');
    expect(k.calls.modals[0]).toContain('Amy Follow-visit');
  });
  it('the note stops at 1,800; Keep note private is shown; the message line is double-quoted', () => {
    const h = setup();
    h.fns._lkOpenStep(F(2));
    const sheet = h.calls.modals[0]!;
    expect(sheet).toContain('maxlength="1800"');
    expect(strip(sheet)).toContain('Keep note private');
    expect(strip(sheet)).toContain("Completing may send this step's message.");
    expect(extractFn(html, '_lkStepHtml')).toContain(`"Completing may send this step's message."`);
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
  it('the sheet shows "Elvanto will show: Self identified leader: <name>" escaped; every value escaped', () => {
    const h = setup('L1', [row(1, { name: 'Ann <b>X</b>', flowName: 'F <i>1</i>', stepName: 'S <u>1</u>', assignedTo: 'Al <s>Y</s>' })]);
    const list = h.fns._lkFlowsHtml();
    for (const raw of ['<b>X', '<i>1', '<u>1', '<s>Y']) expect(list).not.toContain(raw);
    expect(list).toContain('Ann &lt;b&gt;X&lt;/b&gt;');
    h.fns._lkOpenStep(F(1));
    expect(h.calls.modals[0]).toContain('Elvanto will show: Self identified leader: Cody &lt;b&gt;Cobb&lt;/b&gt;');
    expect(h.calls.modals[0]).not.toContain('<b>X');
  });
  it('a refusal from the batch shows on the row; a pending answer offers Cancel', async () => {
    const reply = (outcome: string, extra: any = {}) => (_p: string, b: any) =>
      Promise.resolve({ results: [{ id: b.items[0].id, kind: b.items[0].kind, outcome, ...extra }] });
    const h = setup('L1', [row(1)], reply('refused', { code: 'CONFLICT', reason: 'step-moved', message: 'x' }));
    h.fns._lkQSet([{ kind: 'action', id: P(80), type: 'completeStep', payload: { rowId: F(1) }, note: null, leaderId: 'L1', _f: F(1) }]);
    await h.fns._lkFlush();
    expect(h.calls.posts[0].b.items[0]._f).toBeUndefined();
    expect(strip(h.fns._lkFlowsHtml())).toContain('This step changed in Elvanto. Do it there.');
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
    expect(h.fns._lkFlowsHtml()).not.toContain('_lkOpenStep');
  });
});

// ── F4.1 first-timer tick on the New person form ──
describe('F4.1 first-timer check-in', () => {
  const OK = { student: 'sent', parent: 'sent' };
  it('_lkFirstTimerDecision: live send queues unless the student form failed or was not sent', () => {
    const d = makeEnv().fns._lkFirstTimerDecision;
    expect(d(OK, 'live', ['Ava', 'Example']).queue).toBe(true);
    expect(d({ ...OK, student: 'unconfirmed' }, 'shadow', ['Ava', 'Example']).queue).toBe(true);
    expect(d({ ...OK, student: 'failed' }, 'live', ['Ava', 'Example']).queue).toBe(false);
    expect(d({ ...OK, student: 'skipped', parent: 'sent' }, 'live', ['Ava', 'Example']).queue).toBe(false); // a parent-only retry
    expect(d(OK, 'off', ['Ava', 'Example']).queue).toBe(false);
  });
  it('_lkFirstTimerDecision: sends are always live, so a sent student queues whatever the console mode short of off', () => {
    const d = makeEnv().fns._lkFirstTimerDecision;
    for (const cap of ['live', 'shadow', 'locked', null]) expect(d(OK, cap, ['Ava', 'Example']).queue).toBe(true);
  });
  it('_lkFirstTimerDecision: a name over 60 characters is skipped with a note', () => {
    const d = makeEnv().fns._lkFirstTimerDecision;
    const r = d(OK, 'live', ['A'.repeat(61), 'Example']);
    expect(r.queue).toBe(false);
    expect(r.note).toMatch(/too long/);
    expect(d(OK, 'live', ['A'.repeat(60), 'B'.repeat(60)]).queue).toBe(true);
    expect(d({ ...OK, student: 'failed' }, 'live', ['A'.repeat(61), 'x']).note).toBeNull();
  });
  it('_lkFirstTimerPayload: grade 7–12 to a number, gender f/m to female/male', () => {
    const f = makeEnv().fns._lkFirstTimerPayload;
    expect(f({ firstName: ' Ava ', lastName: 'Example', grade: '9', gender: 'f' }, SVC)).toEqual({ serviceTimeId: SVC.serviceTimeId,
      serviceId: SVC.serviceId, firstName: 'Ava', lastName: 'Example', grade: 9, gender: 'female' });
    expect(f({ firstName: 'Ben', lastName: 'Sample', grade: '12', gender: 'm' }, SVC)).toMatchObject({ grade: 12, gender: 'male' });
    for (const g of ['7', '8', '10', '11']) expect(f({ firstName: 'a', lastName: 'b', grade: g, gender: 'm' }, SVC).grade).toBe(Number(g));
    expect(f({ firstName: 'a', lastName: 'b', grade: '', gender: 'm' }, SVC).grade).toBeNull();
  });
  it('the tick: on by default when §2.3 gives a default; else a service select; nothing when the link is off', () => {
    const h = makeEnv();
    const L = h.get().LINK;
    L.services = [{ ...SVC, name: 'Youth <b>' }, { ...SVC, serviceTimeId: P(5), ymd: '2026-10-11', name: 'Morning' }];
    L.defaultSvc = SVC.serviceTimeId;
    const on = h.fns._nyLinkHtml();
    expect(on).toContain('type="checkbox" id="ny-lk-svc"');
    expect(on).toContain(' checked');
    expect(on).toContain('Check them in to Fri 16 Oct · Youth &lt;b&gt;');
    expect(on).not.toContain('<b>');
    L.defaultSvc = null;
    const pick = h.fns._nyLinkHtml();
    expect(pick).toContain('<select class="fs" id="ny-lk-svc">');
    expect(pick).toContain('<option value="">Do not check in</option>');
    expect(pick).not.toContain('checked');
    L.status = { console: { capabilities: { firstTimerCheckIn: 'off' } } };
    expect(h.fns._nyLinkHtml()).toBe('');
    for (const [role, mode] of [['grade', 'off'], ['grade', 'shadow'], ['admin', 'off']]) {
      const k = makeEnv({ role, mode });
      k.get().LINK.services = [SVC]; k.get().LINK.defaultSvc = SVC.serviceTimeId;
      expect(k.fns._nyLinkHtml()).toBe('');
    }
    expect(extractFn(html, 'renderNewYouth')).toContain("${typeof _nyLinkHtml === 'function' && _linkOn() ? `<div class=\"card\" id=\"ny-lk\">${_nyLinkHtml()}</div>` : ''}");
  });
  it('after the send: queues firstTimerCheckIn through the phone queue, once; the New person send is unchanged', () => {
    vi.useFakeTimers();
    const h = makeEnv({ leaderId: 'L1' });
    h.get().LINK.services = [SVC];
    const mine: any = { lkSvc: SVC.serviceTimeId, last: { firstName: 'Ava', lastName: 'Example', grade: '8', gender: 'f' } };
    h.fns._lkFirstTimerAfter(mine, OK);
    const q = h.fns._lkQGet();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'action', type: 'firstTimerCheckIn', note: null, leaderId: 'L1',
      payload: { serviceTimeId: SVC.serviceTimeId, serviceId: SVC.serviceId, firstName: 'Ava', lastName: 'Example', grade: 8, gender: 'female' } });
    expect(mine.lkSvc).toBeNull();
    expect(mine.lkNote).toContain('waiting to send');
    h.fns._lkFirstTimerAfter(mine, OK); // a later retry on the same send never queues again
    expect(h.fns._lkQGet()).toHaveLength(1);
    const long: any = { lkSvc: SVC.serviceTimeId, last: { firstName: 'A'.repeat(61), lastName: 'X', grade: '8', gender: 'f' } };
    h.fns._lkFirstTimerAfter(long, OK);
    expect(h.fns._lkQGet()).toHaveLength(1);
    expect(long.lkNote).toMatch(/too long/);
    const send = extractFn(html, 'nySend');
    expect(send).toContain("mine.lkSvc = send || typeof _nyLkRead !== 'function' ? null : _nyLkRead();");
    expect(send).toContain("if (typeof _lkFirstTimerAfter === 'function') _lkFirstTimerAfter(mine, result);");
    expect(send).toContain("API.post('/intake/new-youth', { ...p, send: send || (mine.sibling ? ['student'] : ['student', 'parent']) }, 45000)");
    expect(extractFn(html, 'renderNewYouth')).toContain('NY.lkNote');
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
  it('four cards render: Status, Matching, Shadow check, Activity', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.today = '2026-10-16';
    const out = h.fns._lkAdminHtml();
    for (const id of ['lk-adm-status', 'lk-adm-match', 'lk-adm-shadow', 'lk-adm-log']) expect(out).toContain(`id="${id}"`);
    const text = strip(out);
    for (const t of ['Status', 'Matching', 'Shadow check', 'Activity']) expect(text).toContain(t);
  });
  it('A4 / X17: the Status card says how to stop all data flow', () => {
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.status = { console: { lastSeenAt: null, online: false, inWindow: false, pollSeconds: null, capabilities: null, consoles: 0 }, mirrors: {} };
    h.get().LINK.adm = h.fns._lkAdmFresh ? h.fns._lkAdmFresh() : { acts: [] };
    expect(strip(h.fns._lkAdmStatusHtml())).toContain('The link screens share the New person switch. To stop all data flow, also Turn off the link on the console.');
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
    expect(aoa[1]).toEqual(['Fri 16 Oct 6:31 pm', 'grade9<b>g</b>', 'iPhone · <i>Safari</i>', 'dev-<1>', 'Cody <s>C</s>', 'Sam <u>S</u>', 'Identity', '', 'logged']);
    const ex = extractFn(html, '_lkLogExport');
    expect(ex).toContain('await _ensureXlsx()');
    expect(ex).toContain('XLSX.writeFile(wb, _lkLogFile(_lkToday()))');
    expect(ex.match(/book_append_sheet/g)).toHaveLength(1);
  });
  it('the Shadow check date defaults to the last Friday', () => {
    const f = makeEnv().fns._lkLastFriday;
    expect(f('2026-10-16')).toBe('2026-10-16'); // a Friday
    expect(f('2026-10-17')).toBe('2026-10-16');
    expect(f('2026-10-22')).toBe('2026-10-16');
    expect(f('2026-10-15')).toBe('2026-10-09');
    const h = makeEnv({ role: 'admin' });
    h.get().LINK.today = '2026-10-19';
    expect(h.fns._lkAdminHtml()).toContain('value="2026-10-16"');
    expect(h.fns._lkAdmShadowHtml()).toContain('type="date"');
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
  it('matching lists Unmatched and Two possible with candidates and their DOB, escaped', () => {
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
});
