// Elvanto link SPA (plan Tasks F1.1–F1.4). Extract-and-run: the REAL functions from public/index.html run against
// small stubs (localStorage, API, modal). No server: /link routes are stubbed with the spec's response shapes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['esc', '_nyModeOf', '_nyMode', '_nyOn', '_linkOn', 'moreItems', 'setMyLeaderId',
  '_lkFresh', '_lkTime', '_lkDay', '_lkSvcLabel', '_lkStatusText', '_lkStatusTone', '_lkCap', '_lkCapOff', '_lkLastSeen',
  '_lkBanner', '_lkKey', '_lkQGet', '_lkQSet', '_lkUuid', '_lkPush', '_lkSchedule', '_lkQueuedIdx', '_lkMerge', '_lkApply',
  '_lkFlush', '_lkFailed', '_lkRetry', '_lkResults', '_lkPill', '_lkLogoutGuard', '_lkClear', '_lkSoftReset', '_lkOnPage',
  '_lkRefreshView', '_lkTop', '_lkSvc', '_lkFilter', '_lkListHtml', '_lkRowHtml', '_lkCheck', '_lkUndo',
  '_lkLeadersView', '_lkLeaderState', '_lkTickedCount', '_lkLeadersHtml', '_lkLeadersFoot', '_lkLeadersDraw',
  '_lkTickLeader', '_lkTickAll', '_lkLeadersSubmit', '_lkOpenLeaders', '_lkTickStop'];

const SVC = { serviceTimeId: '11111111-1111-4111-8111-111111111111', serviceId: '22222222-2222-4222-8222-222222222222',
  name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16' };
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BODY = FNS.map((n) => extractFn(loadIndexHtml(), n)).join('\n');

interface Env { storage: Map<string, string>; failStorage?: boolean; post?: (path: string, body: any, ms?: number) => Promise<any>;
  role?: string; mode?: string; leaderId?: string | null; }

function makeEnv(e: Partial<Env> = {}) {
  const env: Env = { storage: e.storage ?? new Map(), ...e } as Env;
  const calls = { posts: [] as any[], toasts: [] as string[], modals: [] as string[], closed: 0, asks: [] as string[] };
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
    const API = { post: (p, b, ms) => __post(p, b, ms), fresh: () => Promise.reject(new Error('no')) };
    const toast = (m) => __calls.toasts.push(m);
    const modal = (h) => __calls.modals.push(h);
    const closeModal = () => { __calls.closed++; };
    const icS = (k) => '<svg data-ic="' + k + '"></svg>';
    const L = (k) => k;
    const _busOn = () => false;
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
    expect(t({ status: 'sent', reason: null, resultAt: '2026-10-16T09:02:00.000Z' })).toBe('In Elvanto ✓ 7:02 pm');
    expect(t({ status: 'sent', reason: 'already' })).toBe('Already in Elvanto ✓');
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
    expect(strip(h.fns._lkRowHtml(people[4]))).toContain('Check out');
    expect(strip(h.fns._lkRowHtml(people[0]))).toContain('Check in');
    h.fns._lkCheck(P(1), 'checkIn');
    const merged = h.fns._lkMerge(h.get().LINK.people[SVC.serviceTimeId].people, h.fns._lkQGet(), SVC.serviceTimeId);
    const row = strip(h.fns._lkRowHtml(merged[0]));
    expect(row).toContain('Undo');
    expect(row).toContain('Waiting to send.');
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
    expect(r[1]).toContain('lk-done-ic'); expect(r[1]).not.toContain('lk-box'); expect(strip('<' + r[1])).toContain('In Elvanto ✓');
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
      expect(Object.keys(it).sort()).toEqual(['id', 'kind', 'leaderId', 'note', 'payload', 'type']);
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
    // _lkPickService is not loaded here: the call proves the branch without a sheet of leaders.
    expect(() => h.fns._lkOpenLeaders()).toThrow(/_lkPickService/);
    expect(h.calls.modals).toEqual([]);
  });
});
