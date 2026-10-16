// Lane n2 (nav/save fix round 2026-10-16): intake queue, per-family busy, late-reply guards, wording.
// Extract-and-run: the REAL functions from public/index.html run against small stubs.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('B01 Tick Youth result line', () => {
  const f = new Function(`${['_ikVal', '_ikNm', '_ikNames', '_ikPoss', '_ikResultLine'].map((n) => extractFn(HTML, n)).join('\n')}
    return { _ikResultLine };`)();
  const d = { forms: { student: { values: { first: 'Ava', last: 'Nguyen' } }, parent: null } };
  it('youthDemo reads Ticked ..., present tense Tick ...', () => {
    expect(f._ikResultLine({ action: 'youthDemo', role: 'student' }, d)).toBe("Ticked Ava's Youth");
    expect(f._ikResultLine({ action: 'youthDemo', role: 'student' }, d, true)).toBe("Tick Ava's Youth");
  });
});

// ── Intake env: the real queue/send functions against a Map-backed localStorage and a recording API.post. ──
const IK_FNS = ['_ikFresh', '_ik', '_ikOpenAct', '_ikOpenOf', '_ikPost', '_ikOutcome', '_ikLocal', '_ikAnswerSend', '_ikSheetGo',
  '_ikAfterLoad', '_ikAnswersSave'];
const Q_FNS = ['_ikQKey', '_ikQRow', '_ikQGet', '_ikQSet', '_ikQFind', '_ikQFlush', '_ikUnlocal'];
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
    const _ikAns = () => ({ fixes: {}, keeps: {} });
    const _ikAnswerBody = (date, key) => ({ payload: { date, family: [key], choices: {}, pairs: {}, undo: false }, note: null });
    const navBack = () => { __calls.backs++; };
    function _here() { return { k: LINK.ik ? LINK.ik.key : null, p: S.page }; }
    function _still(h) { return !!h && h.k === (LINK.ik ? LINK.ik.key : null) && h.p === S.page; }
    ${o.prelude ?? ''}`;
  const f = new Function('__ls', '__post', '__calls', `${prelude}\n${avail.map((n) => extractFn(HTML, n)).join('\n')}
    return { ${avail.join(', ')}, get S() { return S; }, get LINK() { return LINK; } };`)(ls, post, calls);
  return { f, calls, store };
}
const ROW = (key: string, title = 'Fam ' + key) => ({ row: { key, title }, detail: { steps: [] }, actions: [] as any[] });
const netErr = () => Promise.reject(new Error("Can't reach the server"));
const httpErr = (status: number) => Promise.reject(Object.assign(new Error('HTTP ' + status), { status }));
const kept = (store: Map<string, string>) => JSON.parse(store.get('ysc.ikq.u1') ?? '[]');

describe('S-3 intake POST timeout', () => {
  it('_ikPost waits 25 s so the server 503 guard (20 s) answers first', async () => {
    const { f, calls } = ikEnv();
    await f._ikPost([{ kind: 'action', id: P(1), type: 'intakeSave', payload: { date: '2026-10-09', row: 'r1' } }]);
    expect(calls.posts[0].t).toBe(25000);
  });
});

describe('C-B9 intake queue (D2/D3): kept until answered, resent with the SAME ids', () => {
  const SAVE = (id: string, row = 'r1') => ({ kind: 'action', id, type: 'intakeSave', payload: { date: '2026-10-09', row, confirmed: ['k1'], one: false }, note: null, leaderId: null });
  const ok = (b: any, outcome = 'saved') => Promise.resolve({ results: b.items.map((it: any) => ({ id: it.id, kind: 'action', outcome })) });

  it('writes the entry to ysc.ikq.<uid> BEFORE the fetch, with keepalive', async () => {
    const { f, calls, store } = ikEnv();
    await f._ikPost([SAVE(P(1))]);
    const before = new Map<string, string>(calls.posts[0].stored);
    expect(JSON.parse(before.get('ysc.ikq.u1')!)[0].items[0].id).toBe(P(1));
    expect(calls.posts[0].k).toBe(true);
    expect(store.has('ysc.ikq.u1')).toBe(false); // answered -> removed
  });
  it('a network error or 5xx keeps the entry and rethrows; a 4xx refusal removes it; 401 keeps', async () => {
    const cases: [() => Promise<any>, boolean][] = [[netErr, true], [() => httpErr(503), true], [() => httpErr(400), false], [() => httpErr(401), true]];
    for (const [mk, keep] of cases) {
      const { f, store } = ikEnv({ post: mk });
      await expect(f._ikPost([SAVE(P(1))])).rejects.toBeTruthy();
      expect(kept(store).length, String(keep)).toBe(keep ? 1 : 0);
    }
  });
  it('a reply that leaves an id unanswered keeps only that item', async () => {
    const { f, store } = ikEnv({ post: (b) => Promise.resolve({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'saved' }] }) });
    await f._ikPost([SAVE(P(1)), SAVE(P(2), 'r2')]);
    expect(kept(store).flatMap((e: any) => e.items.map((i: any) => i.id))).toEqual([P(2)]);
  });
  it('_ikQFlush resends kept items byte-identical (same ids), then drops them once answered', async () => {
    let fail = true;
    const { f, calls, store } = ikEnv({ post: (b) => (fail ? netErr() : ok(b, 'replay')) });
    await expect(f._ikPost([SAVE(P(1))])).rejects.toBeTruthy();
    fail = false;
    await f._ikQFlush();
    expect(calls.posts.length).toBe(2);
    expect(calls.posts[1].b.items).toEqual(calls.posts[0].b.items);
    expect(calls.posts[1].k).toBe(true);
    expect(store.has('ysc.ikq.u1')).toBe(false);
    await f._ikQFlush();
    expect(calls.posts.length).toBe(2); // nothing left
  });
  it('a flush that fails again keeps the entry (never a new id)', async () => {
    const { f, calls, store } = ikEnv({ post: () => netErr() });
    await expect(f._ikPost([SAVE(P(1))])).rejects.toBeTruthy();
    await f._ikQFlush(); await f._ikQFlush();
    expect(calls.posts.map((c) => c.b.items[0].id)).toEqual([P(1), P(1), P(1)]);
    expect(kept(store).length).toBe(1);
  });
  it('entries over 24 h are dropped unsent with a toast', async () => {
    const { f, calls, store } = ikEnv();
    store.set('ysc.ikq.u1', JSON.stringify([{ at: new Date(Date.now() - 25 * 3600e3).toISOString(), items: [SAVE(P(1))] }]));
    await f._ikQFlush();
    expect(calls.posts.length).toBe(0);
    expect(store.has('ysc.ikq.u1')).toBe(false);
    expect(calls.toasts.join(' ')).toMatch(/1 save from .* was not sent/);
  });
  it('another login: entries over 24 h are swept; fresh ones are left alone and never sent', async () => {
    const { f, calls, store } = ikEnv();
    store.set('ysc.ikq.u2', JSON.stringify([{ at: new Date(Date.now() - 25 * 3600e3).toISOString(), items: [SAVE(P(1))] }]));
    store.set('ysc.ikq.u3', JSON.stringify([{ at: new Date().toISOString(), items: [SAVE(P(2))] }]));
    await f._ikQFlush();
    expect(store.has('ysc.ikq.u2')).toBe(false);
    expect(store.has('ysc.ikq.u3')).toBe(true);
    expect(calls.posts.length).toBe(0);
  });
  it('a consent lookup (a read) is never kept', async () => {
    const { f, store } = ikEnv({ post: () => netErr() });
    await expect(f._ikPost([{ kind: 'action', id: P(1), type: 'consentLookup', payload: { kind: 'forms' } }])).rejects.toBeTruthy();
    expect(store.has('ysc.ikq.u1')).toBe(false);
  });
  it('a flush never re-sends an entry whose POST is still in flight', async () => {
    let release: () => void = () => {};
    const { f, calls } = ikEnv({ post: (b, n) => (n === 1 ? new Promise((r) => { release = () => r(ok(b)); }) : ok(b)) });
    const p = f._ikPost([SAVE(P(1))]);
    await f._ikQFlush();
    expect(calls.posts.length).toBe(1);
    release(); await p;
  });
  it('a newer answer set for the same family replaces the kept older one (the old one is never sent after it)', async () => {
    const ANS = (id: string) => ({ kind: 'action', id, type: 'intakeAnswer', payload: { date: '2026-10-09', family: ['r1', 'p1'] }, note: null, leaderId: null });
    let fail = true;
    const { f, calls, store } = ikEnv({ post: (b) => (fail ? netErr() : ok(b)) });
    await expect(f._ikPost([ANS(P(1))])).rejects.toBeTruthy();
    await expect(f._ikPost([ANS(P(2))])).rejects.toBeTruthy();
    expect(kept(store).flatMap((e: any) => e.items.map((i: any) => i.id))).toEqual([P(2)]);
    fail = false;
    await f._ikQFlush();
    expect(calls.posts[2].b.items.map((i: any) => i.id)).toEqual([P(2)]);
  });
  it('sheet Save: Pending shows before the reply; a second Save while kept reuses the kept id and payload', async () => {
    let fail = true;
    const seen: any[] = [];
    const env = ikEnv({ post: (b) => { seen.push(JSON.parse(JSON.stringify(env.f.LINK.ik.det.actions))); return fail ? netErr() : ok(b); } });
    const { f, calls, store } = env;
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'r1'; I.det = ROW('r1'); I.list = { rows: [{ key: 'r1', actions: [] }] };
    I.sheet = { type: 'intakeSave', key: 'r1', keys: ['k1'], one: false };
    await f._ikSheetGo();
    expect(seen[0][0]).toMatchObject({ type: 'intakeSave', status: 'pending' }); // drawn before the await
    expect(I.det.actions.length).toBe(0); // network error: the optimistic row is taken back
    expect(kept(store).length).toBe(1);
    fail = false;
    I.sheet = { type: 'intakeSave', key: 'r1', keys: ['k1', 'k2'], one: false }; // the plan moved on: still the kept attempt
    await f._ikSheetGo();
    expect(calls.posts[1].b.items[0].id).toBe(calls.posts[0].b.items[0].id);
    expect(calls.posts[1].b.items[0].payload).toEqual(calls.posts[0].b.items[0].payload);
    expect(store.has('ysc.ikq.u1')).toBe(false);
    expect(I.det.actions[0]).toMatchObject({ id: calls.posts[0].b.items[0].id, status: 'pending' });
  });
  it('sheet Save for another type on the same row gets its own id', async () => {
    const { f, calls, store } = ikEnv({ post: (b, n) => (n === 1 ? netErr() : ok(b)) });
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'r1'; I.det = ROW('r1');
    I.sheet = { type: 'intakeSave', key: 'r1', keys: ['k1'], one: false };
    await f._ikSheetGo();
    I.sheet = { type: 'intakeText', key: 'r1', keys: ['complete:parent:x'], one: true };
    await f._ikSheetGo();
    expect(calls.posts[1].b.items[0].id).not.toBe(calls.posts[0].b.items[0].id);
    expect(kept(store).length).toBe(1);
  });
});

describe('S-4 client: no cancel item (the server supersedes the open answer)', () => {
  it('a new answer with a pending one open sends ONE action item, no cancel', async () => {
    const { f, calls } = ikEnv();
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'r1'; I.det = ROW('r1');
    I.det.actions = [{ id: P(80), type: 'intakeAnswer', status: 'pending' }];
    await f._ikAnswerSend(false);
    expect(calls.posts[0].b.items).toHaveLength(1);
    expect(calls.posts[0].b.items[0]).toMatchObject({ kind: 'action', type: 'intakeAnswer' });
  });
});

describe('C-B3 busy per family; a failed answer is resent by the flush without that family open', () => {
  it('A in flight, B sends at once; B fails -> flush with A open resends B with the same id', async () => {
    let releaseA: () => void = () => {};
    let bFails = true;
    const ok = (b: any) => ({ results: b.items.map((it: any) => ({ id: it.id, kind: 'action', outcome: 'saved' })) });
    const { f, calls, store } = ikEnv({ post: (b, n) => {
      const fam = b.items[0].payload.family[0];
      if (fam === 'A' && n === 1) return new Promise((r) => { releaseA = () => r(ok(b)); });
      if (fam === 'B' && bFails) return netErr();
      return Promise.resolve(ok(b));
    } });
    const I = f._ik(); I.date = '2026-10-09';
    I.key = 'A'; I.det = ROW('A');
    const pa = f._ikAnswerSend(false);
    expect(I.busy).toBeTruthy();
    I.key = 'B'; I.det = ROW('B');
    await f._ikAnswerSend(false);
    expect(calls.posts.length).toBe(2); // not parked behind A
    expect(I.resend.B).toBe(true);
    const bId = calls.posts[1].b.items[0].id;
    expect(kept(store).flatMap((e: any) => e.items.map((i: any) => i.id))).toContain(bId); // A is kept too while in flight
    I.key = 'A'; I.det = ROW('A');
    bFails = false;
    await f._ikQFlush();
    expect(calls.posts[2].b.items[0].id).toBe(bId);
    expect(I.resend.B).toBeUndefined();
    releaseA(); await pa;
    expect(I.busy).toBeFalsy(); // _swIdle reads it
  });
  it('a second send for the SAME family while it is in flight waits (resend), and the busy count stays right', async () => {
    let release: () => void = () => {};
    const { f, calls } = ikEnv({ post: (b) => new Promise((r) => { release = () => r({ results: b.items.map((it: any) => ({ id: it.id, kind: 'action', outcome: 'saved' })) }); }) });
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'A'; I.det = ROW('A');
    const p = f._ikAnswerSend(false);
    await f._ikAnswerSend(false);
    expect(calls.posts.length).toBe(1);
    expect(I.resend.A).toBe(true);
    release(); await p;
    expect(I.busy).toBeFalsy();
  });
  it('the retry after load never makes a new id for a kept answer', async () => {
    const { f, calls } = ikEnv({ post: () => netErr() });
    const I = f._ik(); I.date = '2026-10-09'; I.key = 'A'; I.det = ROW('A');
    await f._ikAnswerSend(false);
    f._ikAfterLoad();
    await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
    expect(new Set(calls.posts.map((c) => c.b.items[0].id)).size).toBe(1);
  });
});

describe('C-B1 Save answers: a late ok goes back only if the user is still on that family', () => {
  const mk = (move: (env: any) => void) => {
    const env: any = { backs: 0, toasts: [] as string[], S: { page: 'link-intake' }, LINK: { ik: null } };
    env.LINK.ik = { key: 'A', det: { row: { key: 'A', title: 'Ava Nguyen' } }, busy: 0, busyKey: {}, resend: {} };
    const f = new Function('env', `
      const S = env.S, LINK = env.LINK;
      function _ik() { return LINK.ik; }
      async function _ikAnswerSend() { env.move(env); return true; }
      function toast(m) { env.toasts.push(m); }
      function navBack() { env.backs++; }
      function _here() { return { k: LINK.ik.key, p: S.page }; }
      function _still(h) { return h.k === LINK.ik.key && h.p === S.page; }
      ${extractFn(HTML, '_ikAnswersSave')}
      return { _ikAnswersSave };`)(Object.assign(env, { move }));
    return { env, f };
  };
  it('unchanged -> navBack once, toast names the family', async () => {
    const t = mk(() => {});
    await t.f._ikAnswersSave();
    expect(t.env.backs).toBe(1);
    expect(t.env.toasts).toContain('Answers saved for Ava Nguyen');
  });
  it('family changed or page left before the reply -> no navBack (toast still names the family)', async () => {
    for (const move of [(e: any) => { e.LINK.ik.key = 'B'; }, (e: any) => { e.S.page = 'home'; }]) {
      const t = mk(move);
      await t.f._ikAnswersSave();
      expect(t.env.backs).toBe(0);
      expect(t.env.toasts).toContain('Answers saved for Ava Nguyen');
    }
  });
});

describe('B18 client: only a real page entry marks the intake viewed', () => {
  const run = async (quiet: boolean) => {
    const urls: string[] = [];
    const f = new Function('urls', `
      const I0 = { tab: 'intake', gen: 0, date: null, key: null };
      function _ik() { return I0; }
      const API = { fresh: (p) => { urls.push(p); return Promise.resolve(p.includes('date=') ? { rows: [] } : { dates: [{ date: '2026-10-09' }] }); } };
      const _intakeOn = () => true, _ikLoadRow = async () => {}, _ikAfterLoad = () => {}, _ikDraw = () => {}, _ikSchedule = () => {};
      ${extractFn(HTML, '_ikLoad')}
      return { _ikLoad };`)(urls);
    await f._ikLoad(quiet);
    return urls;
  };
  it('first load adds view=1 to the dates call; a quiet poll never does', async () => {
    expect((await run(false))[0]).toBe('/link/intake?mode=intake&view=1');
    expect((await run(true)).some((u) => u.includes('view=1'))).toBe(false);
  });
});
