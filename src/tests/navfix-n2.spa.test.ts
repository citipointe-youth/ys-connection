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
const Q_FNS = ['_ikQKey', '_ikQGet', '_ikQSet', '_ikQFind', '_ikQFlush'];
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
