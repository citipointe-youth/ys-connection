// Review fixes (RV-*) for the nav/save fix round 2026-10-16: intake queue, logout, consents, notices.
// Extract-and-run: the REAL functions from public/index.html run against small stubs.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// ── Intake env: the real queue/send functions against a Map-backed localStorage and a recording API.post. ──
const IK_FNS = ['_ikFresh', '_ik', '_ikOpenAct', '_ikOpenOf', '_ikPost', '_ikOutcome', '_ikLocal', '_ikAnswerSend', '_ikSheetGo',
  '_ikAfterLoad', '_ikAnswersSave'];
const Q_FNS = ['_ikQKey', '_ikQRow', '_ikQSlot', '_ikSame', '_ikQGet', '_ikQSet', '_ikQFind', '_ikQFlush', '_ikQApply', '_ikUnlocal'];
type PostFn = (b: any, n: number) => any;
function ikEnv(o: { post?: PostFn; fns?: string[]; prelude?: string } = {}) {
  const store = new Map<string, string>();
  const calls = { posts: [] as any[], toasts: [] as string[], backs: 0, loads: 0 };
  const ls = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  const post = (p: string, b: any, t: any, q: any, k: any) => {
    calls.posts.push({ p, b, t, q, k, stored: JSON.parse(JSON.stringify([...store.entries()])) });
    return o.post ? o.post(b, calls.posts.length) : Promise.resolve({ results: b.items.map((it: any) => ({ id: it.id, kind: it.kind, outcome: 'saved' })) });
  };
  const names = [...IK_FNS, ...(o.fns ?? Q_FNS)];
  const avail = names.filter((n) => { try { extractFn(HTML, n); return true; } catch { return false; } });
  const prelude = `
    var S = { user: { id: 'u1', role: 'admin' }, page: 'link-intake' };
    var LINK = { ik: null };
    var NAV = { stack: [{}, {}] };
    const localStorage = __ls; const navigator = { userAgent: 'x' };
    const _deviceId = () => 'dev-1', _deviceLabel = () => 'iPhone';
    const API = { post: (p, b, t, q, k) => __post(p, b, t, q, k) };
    const toast = (m) => __calls.toasts.push(m);
    let __n = 0; const _lkUuid = () => 'id-' + (++__n);
    const _lkDay = (d) => d; const closeModal = () => {}; const _ikDraw = () => {}; const _ikSchedule = () => {};
    const _ikLoad = () => { __calls.loads++; return Promise.resolve(); };
    const _hubLoad = () => {};
    const _ikAns = () => ({ fixes: {}, keeps: {} });
    const _ikAnswerBody = (date, key) => ({ payload: { date, family: [key], choices: {}, pairs: {}, undo: false }, note: null });
    const navBack = () => { __calls.backs++; };
    function _here() { return { k: LINK.ik ? LINK.ik.key : null, p: S.page }; }
    function _still(h) { return !!h && h.k === (LINK.ik ? LINK.ik.key : null) && h.p === S.page; }
    ${o.prelude ?? ''}
    ${SITE_TIME_SRC}`;
  const f = new Function('__ls', '__post', '__calls', `${prelude}\n${avail.map((n) => extractFn(HTML, n)).join('\n')}
    return { ${avail.join(', ')}, get S() { return S; }, get LINK() { return LINK; } };`)(ls, post, calls);
  return { f, calls, store };
}
const ROW = (key: string, title = 'Fam ' + key) => ({ row: { key, title }, detail: { steps: [] }, actions: [] as any[] });
const netErr = () => Promise.reject(new Error("Can't reach the server"));
const httpErr = (status: number) => Promise.reject(Object.assign(new Error('HTTP ' + status), { status }));
const kept = (store: Map<string, string>) => JSON.parse(store.get('ysc.ikq.u1') || '[]');
const okb = (b: any, outcome = 'saved') => ({ results: b.items.map((it: any) => ({ id: it.id, kind: 'action', outcome })) });
const ANS = (id: string, fam = 'Y') => ({ kind: 'action', id, type: 'intakeAnswer', payload: { date: '2026-10-09', family: [fam], choices: {}, pairs: {}, undo: false }, note: null, leaderId: null });
const SAVE = (id: string, row = 'r1', confirmed = ['k1']) => ({ kind: 'action', id, type: 'intakeSave', payload: { date: '2026-10-09', row, confirmed, one: false }, note: null, leaderId: null });
const at = (min = 0) => new Date(Date.now() - min * 60e3).toISOString();
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('RV-I-M1 an older answer set is never posted after a newer one', () => {
  it('flush [E1, A(Y)]: B(Y) posted while E1 is in flight -> A is never posted', async () => {
    let release: () => void = () => {};
    const { f, calls, store } = ikEnv({ post: (b, n) => (n === 1 ? new Promise((r) => { release = () => r(okb(b)); }) : Promise.resolve(okb(b))) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(2), items: [SAVE(P(1))] }, { at: at(1), items: [ANS(P(2))] }]));
    const fl = f._ikQFlush();
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'Y'; I.det = ROW('Y');
    await f._ikAnswerSend(false); // B
    expect(calls.posts.length).toBe(2);
    release(); await fl;
    expect(calls.posts.flatMap((c) => c.b.items.map((i: any) => i.id))).not.toContain(P(2));
  });
  it('boot flush (no intake page open) sending A(Y): opening Y and editing parks B until A is answered', async () => {
    let release: () => void = () => {};
    const { f, calls, store } = ikEnv({ post: (b, n) => (n === 1 ? new Promise((r) => { release = () => r(okb(b)); }) : Promise.resolve(okb(b))) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [ANS(P(2))] }]));
    expect(f.LINK.ik).toBe(null);
    const fl = f._ikQFlush();
    expect(calls.posts.length).toBe(1);
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'Y'; I.det = ROW('Y');
    await f._ikAnswerSend(false);
    expect(calls.posts.length).toBe(1); // parked, not racing A
    expect(I.resend.Y).toBe('again');
    release(); await fl;
    expect(I.busy).toBeFalsy();
  });
});

describe('RV-I-M2 after the logout clear nothing is sent or written back', () => {
  const fns = [...Q_FNS, '_ikQLogout', '_lkSoftReset'];
  const prelude = 'const _lkFresh = () => ({ ik: null });';
  it('a hanging first post answered after the cap: key stays absent, no second POST (also across _lkSoftReset)', async () => {
    let release: () => void = () => {};
    const { f, calls, store } = ikEnv({ fns, prelude, post: (b, n) => (n === 1 ? new Promise((r) => { release = () => r(okb(b)); }) : Promise.resolve(okb(b))) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(2), items: [SAVE(P(1))] }, { at: at(1), items: [SAVE(P(2), 'r2')] }]));
    await f._ikQLogout(30);
    expect(store.has('ysc.ikq.u1')).toBe(false);
    f._lkSoftReset(); // doLogout's _lkClear runs while POST /auth/logout is still out
    release(); await tick(); await tick();
    expect(calls.posts.length).toBe(1);
    expect(store.has('ysc.ikq.u1')).toBe(false);
    await expect(f._ikPost([SAVE(P(3), 'r3')])).rejects.toBeTruthy(); // a sheet Save in the same window: refused, not kept
    expect(store.has('ysc.ikq.u1')).toBe(false);
    expect(calls.posts.length).toBe(1);
  });
  it('the next login lifts the stop; doLogin calls _ikQLogin right after S.user is set', async () => {
    const { f, calls, store } = ikEnv({ fns: [...fns, '_ikQLogin'], prelude });
    await f._ikQLogout(30);
    f._ikQLogin();
    await f._ikPost([SAVE(P(4))]);
    expect(calls.posts.length).toBe(1);
    expect(store.has('ysc.ikq.u1')).toBe(false);
    const src = extractFn(HTML, 'doLogin');
    expect(src.indexOf('_ikQLogin(')).toBeGreaterThan(src.indexOf('S.user = res.user'));
  });
});

describe('RV-R8 expired session keeps that login\'s queue; another login signing in clears it', () => {
  const fns = [...Q_FNS, '_ikQLogin', '_lkSoftReset'];
  const prelude = 'const _lkFresh = () => ({ ik: null });';
  it('expiry keeps ysc.ikq.<uid>; the same login resends it; signing in clears other logins\' keys (fresh or not)', async () => {
    const { f, calls, store } = ikEnv({ fns, prelude });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(30), items: [SAVE(P(1))] }]));
    store.set('ysc.ikq.u2', JSON.stringify([{ at: at(5), items: [SAVE(P(2))] }]));
    f._lkSoftReset(); // _handleAuthExpired
    expect(store.has('ysc.ikq.u1')).toBe(true);
    f._ikQLogin(); // u1 signs in again
    expect(store.has('ysc.ikq.u2')).toBe(false);
    expect(store.has('ysc.ikq.u1')).toBe(true);
    await f._ikQFlush(); // _lkBoot after login
    expect(calls.posts.map((c) => c.b.items[0].id)).toEqual([P(1)]);
  });
  it('_handleAuthExpired never clears the intake queue', () => {
    expect(extractFn(HTML, '_handleAuthExpired')).not.toMatch(/ikq|_ikQSet|_ikQLogout/);
  });
});

// New person harness (copied from navfix-n4.spa.test.ts).
const fns = (names: string[]) => names.map((n) => extractFn(HTML, n)).join('\n');
// The real New person functions against small stubs (pattern from new-youth.spa.test.ts).
const NY_FNS = ['_nyModeOf', '_nyMode', '_nyOn', '_nyDobMask', '_nyDobIso', '_nyDobShow', '_nyDobError', '_nyToday', '_nyDobProblem', '_nyHost', '_nyHostHtml', '_nyHostDraw', '_nyPickHost', '_nyMessage', '_nyErrorText', 'toAuMobile', 'tidyName', '_nyFieldMsgs', '_nyRaw', '_nyShowMsgs', 'nySend', 'nyReset', 'nyOpen', 'nyBack', 'nySibling', 'renderNewYouth', '_nyReqDismiss'];
function nyHarness(post: (path: string, body: any, ...rest: any[]) => Promise<any>, store: Record<string, string> = {}, lsOverride?: any) {
  const S: any = { user: { id: 'u1', role: 'admin' }, page: 'new-youth', settings: { ministryConfig: { modules: { newYouthForms: 'on' } } } };
  const pages: string[] = [];
  const toasts: string[] = [];
  const button: any = { disabled: false, textContent: 'Send to Elvanto', isConnected: true };
  const body = { host: 'H', firstName: 'Alex', lastName: 'T', dob: '2012-04-03', gender: 'm', grade: '8', school: 'S', mobile: '0412345678', parentFirst: 'P', parentLast: 'T', parentMobile: '0498765432' };
  const ref: any = {};
  const ls = lsOverride ?? { getItem: (k: string) => (k in store ? store[k]! : null), setItem: (k: string, v: string) => { store[k] = String(v); }, removeItem: (k: string) => { delete store[k]; } };
  const doc = { getElementById: (id: string) => (id === 'ny-send' ? button : null), querySelector: () => null };
  const factory = new Function('S', 'API', 'toast', 'document', 'localStorage', 'setApp', 'shell', 'esc', 'go', 'window', '_nyRead', 'NY_ALLERGIES', 'NY_CONDITIONS',
    'getMyLeaderId', '_lkMyName', '_lkIamPick', '_gradeList', 'NY_ERR_IDS', 'navigator',
    `let NY = { keep: null, sibling: false, sending: false, result: null, last: null, error: null, unknown: false };
    ${fns(NY_FNS)}
    ${SITE_TIME_SRC}
    return { nySend, nyOpen, nyReset, nyBack, renderNewYouth, get NY() { return NY; }, set NY(v) { NY = v; } };`);
  const h = factory(S, { post }, (m: string) => toasts.push(m), doc, ls,
    (x: string) => pages.push(x), (x: string) => x, (x: any) => String(x), (p: string) => { S.page = p; if (p === 'new-youth') ref.h.renderNewYouth(); }, { scrollTo() {} },
    () => ({ ...body }), [], [], () => 'L1', () => 'H', () => {}, () => [7, 8, 9, 10, 11, 12], ['mobile'], { onLine: true });
  ref.h = h;
  return { h, S, pages, toasts, store, body, last: () => pages[pages.length - 1] ?? '' };
}


describe('RV-C-m1 New person: an "unconfirmed" repeat reply keeps the stored request id', () => {
  const KEY = 'ysc.nyReq.u1';
  it('repeat + unconfirmed keeps the marker, so the next Send for the same person reuses the id; a definite repeat clears it', async () => {
    const bodies: any[] = [];
    let reply: any = { student: 'unconfirmed', parent: 'unconfirmed', dryRun: false, repeat: true };
    const t = nyHarness(async (_p, body) => { bodies.push(body); return reply; });
    await t.h.nySend({ preventDefault() {} });
    expect(JSON.parse(t.store[KEY]!).id).toBe(bodies[0].requestId);
    t.h.nyBack();
    reply = { student: 'sent', parent: 'sent', dryRun: false, repeat: true };
    await t.h.nySend({ preventDefault() {} });
    expect(bodies[1].requestId).toBe(bodies[0].requestId);
    expect(t.store[KEY]).toBeUndefined();
  });
});

describe('RV-I-m3 sheet Save reuses a kept entry only for the same payload', () => {
  it('kept save with other keys: the newer Save gets a new id and replaces the kept one (only the new one is ever sent again)', async () => {
    let fail = true;
    const { f, calls, store } = ikEnv({ post: (b) => (fail ? netErr() : Promise.resolve(okb(b))) });
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'r1'; I.det = ROW('r1');
    I.sheet = { type: 'intakeSave', key: 'r1', keys: ['k1'], one: true };
    await f._ikSheetGo();
    I.sheet = { type: 'intakeSave', key: 'r1', keys: ['k1', 'k2'], one: false };
    await f._ikSheetGo();
    const [a, b] = calls.posts.map((c) => c.b.items[0]);
    expect(b.id).not.toBe(a.id);
    expect(b.payload).toMatchObject({ confirmed: ['k1', 'k2'], one: false });
    expect(kept(store).flatMap((e: any) => e.items.map((i: any) => i.id))).toEqual([b.id]);
    fail = false;
    await f._ikQFlush();
    expect(calls.posts.slice(2).flatMap((c) => c.b.items.map((i: any) => i.id))).toEqual([b.id]);
  });
  it('same payload again: the kept id is reused', async () => {
    const { f, calls } = ikEnv({ post: (b, n) => (n === 1 ? netErr() : Promise.resolve(okb(b))) });
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'r1'; I.det = ROW('r1');
    I.sheet = { type: 'intakeSave', key: 'r1', keys: ['k1'], one: false };
    await f._ikSheetGo();
    I.sheet = { type: 'intakeSave', key: 'r1', keys: ['k1'], one: false };
    await f._ikSheetGo();
    expect(calls.posts[1].b.items[0].id).toBe(calls.posts[0].b.items[0].id);
  });
  it('a kept text for another key is left alone (both texts go)', async () => {
    const { f, calls, store } = ikEnv({ post: () => netErr() });
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'r1'; I.det = ROW('r1');
    I.sheet = { type: 'intakeText', key: 'r1', keys: ['complete:parent:x'], one: true };
    await f._ikSheetGo();
    I.sheet = { type: 'intakeText', key: 'r1', keys: ['complete:student:y'], one: true };
    await f._ikSheetGo();
    expect(calls.posts[1].b.items[0].id).not.toBe(calls.posts[0].b.items[0].id);
    expect(kept(store).flatMap((e: any) => e.items).length).toBe(2);
  });
});

describe('RV-I-m4 Save all reuses the ids of kept rows', () => {
  it('a row whose save is kept with the same payload goes with its kept id; other rows get new ids', async () => {
    const { f, calls, store } = ikEnv({ fns: [...Q_FNS, '_ikSaveAllGo'] });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [SAVE(P(1), 'r1', ['k1'])] }]));
    const I = f._ik(); I.date = '2026-10-09';
    const it = (row: string) => ({ key: row, title: 'T ' + row, payload: { date: '2026-10-09', row, confirmed: ['k1'], one: false } });
    I.sa = { type: 'intakeSave', date: '2026-10-09', items: [it('r1'), it('r2')] };
    await f._ikSaveAllGo();
    const ids = calls.posts[0].b.items.map((i: any) => i.id);
    expect(ids[0]).toBe(P(1));
    expect(ids[1]).not.toBe(P(1));
  });
});

describe('RV-I-m5 the flush applies consent fix/link and sheet results', () => {
  const prelude = 'const _ikFixPoll = () => { __calls.fixPolls = (__calls.fixPolls || 0) + 1; };';
  const FIX = (id: string) => ({ kind: 'action', id, type: 'consentFix', payload: { personId: 'p1', subId: 's1' }, note: null, leaderId: null });
  it('a kept consentFix that lands turns "goes again by itself" into Pending and starts the poll', async () => {
    const { f, calls, store } = ikEnv({ prelude });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [FIX(P(1))] }]));
    const I = f._ik();
    I.fixes = { p1: { id: P(1), status: 'failed', detail: 'Not sent yet. It goes again by itself.', noAns: true, sub: 's1' } };
    await f._ikQFlush();
    expect(I.fixes.p1).toMatchObject({ id: P(1), status: 'pending' });
    expect((calls as any).fixPolls).toBe(1);
  });
  it('a kept fix refused on resend shows the reason; a 4xx for the whole batch too', async () => {
    const { f, store } = ikEnv({ prelude, post: (b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'refused', message: 'Too old.' }] }) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [FIX(P(1))] }]));
    const I = f._ik();
    I.fixes = { p1: { id: P(1), status: 'failed', detail: 'Not sent yet. It goes again by itself.', noAns: true } };
    await f._ikQFlush();
    expect(I.fixes.p1).toMatchObject({ status: 'failed', detail: 'Too old.' });
    const e2 = ikEnv({ prelude, post: () => httpErr(400) });
    e2.store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [FIX(P(1))] }]));
    const I2 = e2.f._ik();
    I2.fixes = { p1: { id: P(1), status: 'failed', detail: 'Not sent yet. It goes again by itself.', noAns: true } };
    await e2.f._ikQFlush();
    expect(I2.fixes.p1.detail).toBe('HTTP 400');
  });
  it('a kept sheet save refused on resend is toasted, naming the family', async () => {
    const { f, calls, store } = ikEnv({ prelude, post: (b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'refused', message: 'The plan changed.' }] }) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [SAVE(P(1), 'r1')] }]));
    const I = f._ik(); I.list = { rows: [{ key: 'r1', title: 'Smith family' }] };
    await f._ikQFlush();
    expect(calls.toasts).toEqual(['Smith family: The plan changed.']);
  });
});

describe('RV-I-m6 I.resend cannot stick', () => {
  it('a flush 4xx that drops a kept answer clears its resend flag', async () => {
    const { f, store } = ikEnv({ post: () => httpErr(400) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [ANS(P(1))] }]));
    const I = f._ik(); I.resend.Y = true;
    await f._ikQFlush();
    expect(I.resend.Y).toBeUndefined();
  });
  it('an answer dropped as over 24 h clears its resend flag', async () => {
    const { f, store } = ikEnv();
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(25 * 60), items: [ANS(P(1))] }]));
    const I = f._ik(); I.resend.Y = true;
    await f._ikQFlush();
    expect(I.resend.Y).toBeUndefined();
  });
  it('a parked change goes after load while the older answer is only pending (the server supersedes it); a claimed one still waits', async () => {
    const { f, calls } = ikEnv();
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'Y'; I.det = ROW('Y');
    I.det.actions = [{ id: P(5), type: 'intakeAnswer', status: 'claimed' }];
    I.resend.Y = 'again';
    f._ikAfterLoad(); await tick();
    expect(calls.posts.length).toBe(0);
    I.det.actions = [{ id: P(5), type: 'intakeAnswer', status: 'pending' }];
    f._ikAfterLoad(); await tick();
    expect(calls.posts.length).toBe(1);
    expect(I.resend.Y).toBeUndefined();
  });
});

describe('RV-I-m7 LINK_ID_REUSED on a resend means it landed earlier', () => {
  const reused = (b: any) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'refused', code: 'LINK_ID_REUSED', message: 'This action id was already used for a different action.' }] });
  it('a resent answer: entry dropped, resend cleared, a clear toast naming the family', async () => {
    const { f, calls, store } = ikEnv({ post: reused });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [ANS(P(1))] }]));
    const I = f._ik(); I.resend.Y = true; I.list = { rows: [{ key: 'Y', title: 'Lee family' }] };
    await f._ikQFlush();
    expect(store.has('ysc.ikq.u1')).toBe(false);
    expect(I.resend.Y).toBeUndefined();
    expect(calls.toasts).toEqual(['Lee family: These answers were already sent.']);
  });
  it('a resent consent fix: shown as sent-earlier (Pending, the poll reads the real status), no "id used" text', async () => {
    const { f, store } = ikEnv({ post: reused, prelude: 'const _ikFixPoll = () => {};' });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [{ kind: 'action', id: P(1), type: 'consentFix', payload: { personId: 'p1', subId: 's1' }, note: null, leaderId: null }] }]));
    const I = f._ik(); I.fixes = { p1: { id: P(1), status: 'failed', detail: 'Not sent yet. It goes again by itself.', noAns: true } };
    await f._ikQFlush();
    expect(I.fixes.p1).toMatchObject({ id: P(1), status: 'pending' });
  });
});

describe('RV-I-m8 _lkSoftReset keeps the intake queue\'s in-flight and lock state', () => {
  it('ikFly, ikFam, ikFlushing, ikMem, ikMemOnly survive a soft reset (preview, expiry)', () => {
    const { f } = ikEnv({ fns: [...Q_FNS, '_lkSoftReset'], prelude: 'const _lkFresh = () => ({ ik: null });' });
    const L = f.LINK, st = { ikFly: { a: true }, ikFam: { 'd|Y': 1 }, ikFlushing: Promise.resolve(false), ikMem: { 'ysc.ikq.u1': [] }, ikMemOnly: true };
    Object.assign(L, st);
    f._lkSoftReset();
    for (const [k, v] of Object.entries(st)) expect(f.LINK[k], k).toBe(v);
  });
});

describe('RV-I-m9 dead token at logout: the link tap queue is still cleared by the captured key', () => {
  it('doLogout captures the lkq key before _ikQLogout and passes it to _lkClear', () => {
    const src = extractFn(HTML, 'doLogout');
    const cap = src.indexOf('= _lkKey()');
    expect(cap).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(src.indexOf('await _ikQLogout('));
    expect(src).toMatch(/_lkClear\(\w+\)/);
  });
  it('_lkClear(k) removes that key even when S.user is already gone', () => {
    const store = new Map<string, string>([['ysc.lkq.u1', '[]']]);
    const f = new Function('__s', `var S = { user: null }; var LINK = { mem: { 'ysc.lkq.u1': [] } };
      const localStorage = { removeItem: (k) => __s.delete(k) }; let resets = 0; const _lkSoftReset = () => { resets++; };
      ${extractFn(HTML, '_lkKey')}\n${extractFn(HTML, '_lkClear')}
      return { _lkClear, get LINK() { return LINK; } };`)(store);
    f._lkClear('ysc.lkq.u1');
    expect(store.has('ysc.lkq.u1')).toBe(false);
    expect(f.LINK.mem['ysc.lkq.u1']).toBeUndefined();
  });
});

describe('legacy A10 (nav-fix F2): an unclear answer row blocks a parked change like a claimed one', () => {
  it('unclear (lease-lost) holds the open-row slot: no re-POST every load', async () => {
    const { f, calls } = ikEnv();
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'Y'; I.det = ROW('Y');
    I.det.actions = [{ id: P(5), type: 'intakeAnswer', status: 'unclear' }];
    I.resend.Y = 'again';
    f._ikAfterLoad(); await tick();
    expect(calls.posts.length).toBe(0);
    expect(I.resend.Y).toBe('again');
  });
});

describe('legacy A11 (nav-fix F1): a kept save refused while the intake page is closed is never silent', () => {
  const refused = (b: any) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'refused', message: 'The plan changed.' }] });
  it('boot flush (LINK.ik null): a per-item refusal is toasted', async () => {
    const { f, calls, store } = ikEnv({ post: refused });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [SAVE(P(1))] }]));
    expect(f.LINK.ik).toBe(null);
    await f._ikQFlush();
    expect(store.has('ysc.ikq.u1')).toBe(false);
    expect(calls.toasts).toEqual(['A kept intake save was refused: The plan changed.']);
  });
  it('boot flush (LINK.ik null): a whole-POST 4xx is toasted once', async () => {
    const { f, calls, store } = ikEnv({ post: () => httpErr(400) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [SAVE(P(1)), ANS(P(2))] }]));
    await f._ikQFlush();
    expect(calls.toasts).toEqual(['A kept intake save was refused: HTTP 400']);
  });
  it('page open: a kept answer dropped by a whole-POST 4xx is toasted', async () => {
    const { f, calls, store } = ikEnv({ post: () => httpErr(400) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [ANS(P(1))] }]));
    f._ik();
    await f._ikQFlush();
    expect(calls.toasts).toEqual(['A kept intake save was refused: HTTP 400']);
  });
  it('saved / replay / duplicate stay quiet with the page closed', async () => {
    const { f, calls, store } = ikEnv({ post: (b) => Promise.resolve(okb(b, 'duplicate')) });
    store.set('ysc.ikq.u1', JSON.stringify([{ at: at(1), items: [SAVE(P(1))] }]));
    await f._ikQFlush();
    expect(calls.toasts).toEqual([]);
  });
});
