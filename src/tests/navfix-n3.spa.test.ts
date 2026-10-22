// Nav/save fix round 2026-10-16, lane n3 (Consents): C-B4, C-B9 (consent), S-1 (consent restore), S-3 (Save all), D6, D7, B02.
// Extract-and-run: the REAL functions from public/index.html run against small stubs.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const src = (names: string[]) => names.map((n) => extractFn(HTML, n)).join('\n');
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// One intake state + the stubs every lane-n3 function touches. `t` records what happened.
function env(names: string[], o: { fresh?: (p: string) => any; post?: (items: any[]) => any; I?: any; extra?: string } = {}) {
  const t: any = { modals: [] as string[], toasts: [] as string[], posts: [] as any[][], fresh: [] as string[], draws: 0, closed: 0, timers: [] as any[], uuid: 0 };
  const I: any = Object.assign({ tab: 'consent', date: '2026-10-16', key: null, csub: 'last', list: { rows: [] }, fixes: {}, lk: {}, saErr: {},
    saBusy: false, sa: null, fixPoll: null, head: null }, o.I || {});
  const fns = new Function('__t', '__I', '__fresh', '__post', `
    const S = { page: 'link-intake' };
    const NAV = { stack: [] };
    const LINK = { gid: null, rf: null, ik: __I };
    const document = { querySelector: () => null, getElementById: () => null };
    const navigator = { onLine: true };
    const _ik = () => LINK.ik;
    const API = { fresh: (p) => { __t.fresh.push(p); return Promise.resolve().then(() => __fresh(p)); } };
    const _ikPost = (items) => { __t.posts.push(items); return Promise.resolve().then(() => { const r = __post(items); return (r && r.results) || []; }); };
    const _ikOutcome = (res, id) => (res || []).find((r) => r && r.id === id) || null;
    const _ikQFind = () => null, _ikSame = () => false; // RV-I-m4: nothing kept here
    const _lkUuid = () => 'id-' + (++__t.uuid);
    const modal = (h) => __t.modals.push(h);
    const closeModal = () => { __t.closed++; };
    const toast = (m) => __t.toasts.push(m);
    const _ikDraw = () => { __t.draws++; };
    const _ikLoad = () => {};
    const _hubLoad = () => {};
    const _ikLocal = () => {};
    const _ikSt = () => null;
    const _ikSeenLine = () => '';
    const _lkSeen = (iso) => 'SEEN(' + iso + ')';
    const setTimeout = (cb, ms) => { __t.timers.push(ms); return 1; };
    const clearTimeout = () => {};
    const esc = (s) => String(s);
    ${o.extra || ''}
    ${src(names)}
    return { ${names.join(', ')}, S, NAV, LINK };`)(t, I, o.fresh ?? (() => ({})), o.post ?? ((items: any[]) => ({ results: items.map((i) => ({ id: i.id, kind: 'action', outcome: 'saved' })) })));
  return { fns, t, I };
}
const GUARD = ['_navSnap', '_navSame', '_here', '_still'];

describe('S-3 Save all sends chunks of 20 and says when a chunk will go again by itself', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ key: P(i + 1), title: 'Kid ' + i, outcome: '', payload: { row: P(i + 1) } }));
  it('45 items -> 3 POSTs of 20, 20, 5', async () => {
    const { fns, t, I } = env(['_ikSaveAllGo']);
    I.sa = { type: 'consentSave', date: '2026-10-16', items: items(45) };
    await fns._ikSaveAllGo();
    expect(t.posts.map((p: any[]) => p.length)).toEqual([20, 20, 5]);
  });
  it('a chunk that never got an answer (kept on the phone) says it goes again; a 4xx says why', async () => {
    let n = 0;
    const { fns, I } = env(['_ikSaveAllGo'], { post: () => { n++; if (n === 1) throw new Error("Can't reach the server"); const e: any = new Error('Only the admin can do this.'); e.status = 403; throw e; } });
    I.sa = { type: 'consentSave', date: '2026-10-16', items: items(25) };
    await fns._ikSaveAllGo();
    expect(I.saErr[P(1)]).toBe('Not sent yet. It goes again by itself.');
    expect(I.saErr[P(21)]).toBe('Only the admin can do this.');
  });
  it('a 5xx is kept too', async () => {
    const { fns, I } = env(['_ikSaveAllGo'], { post: () => { const e: any = new Error('Server error'); e.status = 503; throw e; } });
    I.sa = { type: 'consentSave', date: '2026-10-16', items: items(1) };
    await fns._ikSaveAllGo();
    expect(I.saErr[P(1)]).toBe('Not sent yet. It goes again by itself.');
  });
});

describe('C-B9 consent fix / link: a retry after no answer reuses the same request id', () => {
  const netErr = () => { throw new Error("Can't reach the server"); };
  it('_ikFixGo: no answer, then again for the same form -> same id (server replay, not a second write)', async () => {
    let n = 0;
    const { fns, t, I } = env(['_ikFixGo', '_ikFixPoll'], { post: (items) => { n++; if (n === 1) netErr(); return { results: [{ id: items[0].id, kind: 'action', outcome: 'replay' }] }; } });
    I.fixPick = { personId: P(4), subId: P(3), dnc: null };
    await fns._ikFixGo();
    expect(I.fixes[P(4)].status).toBe('failed');
    expect(I.fixes[P(4)].detail).toBe('Not sent yet. It goes again by itself.');
    I.fixPick = { personId: P(4), subId: P(3), dnc: null };
    await fns._ikFixGo();
    expect(t.posts[1][0].id).toBe(t.posts[0][0].id);
    expect(I.fixes[P(4)].status).toBe('pending');
  });
  it('_ikFixGo: a different form, or an answered refusal (4xx), gets a new id', async () => {
    let n = 0;
    const { fns, t, I } = env(['_ikFixGo', '_ikFixPoll'], { post: () => { n++; if (n === 1) netErr(); const e: any = new Error('No.'); e.status = 400; throw e; } });
    I.fixPick = { personId: P(4), subId: P(3) };
    await fns._ikFixGo();
    I.fixPick = { personId: P(4), subId: P(5) };
    await fns._ikFixGo();
    expect(t.posts[1][0].id).not.toBe(t.posts[0][0].id);
    expect(I.fixes[P(4)].detail).toBe('No.');
    I.fixPick = { personId: P(4), subId: P(5) };
    await fns._ikFixGo();
    expect(t.posts[2][0].id).not.toBe(t.posts[1][0].id);
  });
  it('_ikClGo: same form + same person after no answer -> same id; a different person -> new id', async () => {
    let n = 0;
    const { fns, t, I } = env(['_ikClGo', '_ikFixPoll'], { post: (items) => { n++; if (n !== 2) netErr(); return { results: [{ id: items[0].id, kind: 'action', outcome: 'saved' }] }; } });
    const to = { personId: P(70), name: 'Riley' };
    I.clPick = { sub: P(1), to, dnc: false };
    await fns._ikClGo();
    expect(I.fixes['cn:' + P(1)].detail).toBe('Not sent yet. It goes again by itself.');
    I.clPick = { sub: P(1), to, dnc: false };
    await fns._ikClGo();
    expect(t.posts[1][0].id).toBe(t.posts[0][0].id);
    expect(I.fixes['cn:' + P(1)].status).toBe('pending');
    I.fixes['cn:' + P(1)] = { id: 'x', status: 'failed', noAns: true, sub: P(1), to };
    I.clPick = { sub: P(1), to: null, dnc: false };
    await fns._ikClGo();
    expect(t.posts[2][0].id).not.toBe('x');
  });
});

describe('B02 a lookup that times out while the console is busy with the service keeps the busy reason', () => {
  it('waiting + console-busy for 6 min -> the busy sentence, not "hasn\'t picked this up"', () => {
    const { fns } = env(['_ikLkApply']);
    const now = Date.now(), x: any = { kind: 'forms', since: now };
    expect(fns._ikLkApply(x, { status: 'waiting', reason: 'console-busy' }, now + 6 * 60000)).toBe(false);
    expect(x.st).toBe('timeout');
    expect(x.msg).toContain('busy with the service');
    expect(x.msg).toContain('Ask again');
    const y: any = { kind: 'forms', since: now, reason: 'console-busy' }; // the reason from an earlier poll counts too
    fns._ikLkApply(y, { status: 'waiting' }, now + 6 * 60000);
    expect(y.msg).toContain('busy with the service');
    const z: any = { kind: 'forms', since: now };
    fns._ikLkApply(z, { status: 'waiting' }, now + 6 * 60000);
    expect(z.msg).toBe("The console hasn't picked this up yet. Tap Ask again later.");
    // N02: console online -> the _ikChip "Queued" wording
    const on = new Function(`const _ikSt = () => ({ console: { online: true } }); const _ikLkReason = () => '';
      ${src(['_ikLkApply'])}; return _ikLkApply;`)();
    const q: any = { kind: 'forms', since: now };
    on(q, { status: 'waiting' }, now + 6 * 60000);
    expect(q.msg).toBe('Queued behind other saves. Tap Ask again later.');
  });
});

describe('D6 a fix / link the console has not picked up after 15 min says since when', () => {
  it('pending 16 min -> since line; pending 5 min -> waiting; claimed never', () => {
    const { fns } = env(['_ikFixText', '_ikClText']);
    const at = new Date(Date.now() - 16 * 60000).toISOString();
    expect(fns._ikFixText({ status: 'pending', createdAt: at }, null)).toEqual(['wait', "Console hasn't picked this up yet (since SEEN(" + at + ')).']);
    expect(fns._ikClText({ status: 'pending', createdAt: at })).toEqual(['wait', "Console hasn't picked this up yet (since SEEN(" + at + ')).']);
    const since = Date.now() - 16 * 60000; // a tap on this phone carries only `since`
    expect(fns._ikFixText({ status: 'pending', since }, null)[1]).toContain("Console hasn't picked this up yet (since SEEN(" + new Date(since).toISOString());
    expect(fns._ikFixText({ status: 'pending', since: Date.now() - 5 * 60000 }, null)).toEqual(['wait', 'Waiting for the console.']);
    expect(fns._ikClText({ status: 'pending', since: Date.now() - 5 * 60000 })).toEqual(['wait', 'Waiting for the console.']);
    expect(fns._ikClText({ status: 'claimed', createdAt: at })[1]).toBe('The console is saving the link…');
  });
});

describe('S-1 consent fix / link lines come back after the app was closed (_ikFixRestore)', () => {
  const row = (o: any) => ({ id: P(90), type: 'consentFix', status: 'pending', reason: null, detail: null, createdAt: new Date(Date.now() - 60000).toISOString(), resultAt: null, ...o });
  const rows: Record<string, any[]> = {
    consentFix: [row({ id: P(91), fixKey: P(4) }), row({ id: P(92), fixKey: P(5), status: 'claimed' }), row({ id: P(93) }) /* old server: no fixKey */,
      row({ id: P(94), fixKey: P(6), status: 'sent', createdAt: new Date().toISOString() }), row({ id: P(95), fixKey: P(6), status: 'pending' }) /* older than the sent one */,
      row({ id: P(96), fixKey: P(7) })],
    consentLink: [row({ id: P(97), type: 'consentLink', fixKey: 'cn:' + P(1) })],
  };
  const fresh = (p: string) => rows[p.split('type=')[1]!] || [];
  it('seeds open rows by fixKey, newest per key, never over a live entry, skips rows with no fixKey', async () => {
    const { fns, t, I } = env(['_ikFixRestore', '_ikFixPoll'], { fresh });
    I.fixes[P(7)] = { id: 'live', status: 'asking', since: Date.now() };
    await fns._ikFixRestore();
    expect(t.fresh).toEqual(['/link/actions?type=consentFix', '/link/actions?type=consentLink']);
    expect(I.fixes[P(4)]).toMatchObject({ id: P(91), status: 'pending' });
    expect(I.fixes[P(5)]).toMatchObject({ id: P(92), status: 'claimed' });
    expect(I.fixes[P(6)]).toBeUndefined(); // newest is sent: nothing to show
    expect(I.fixes[P(7)].id).toBe('live');
    expect(I.fixes['cn:' + P(1)]).toMatchObject({ id: P(97), status: 'pending' });
    expect(I.fixes[P(4)].createdAt).toBe(rows.consentFix![0]!.createdAt); // D6 since-line uses the server time
    expect(Object.keys(I.fixes).length).toBe(4);
    expect(t.timers.length).toBe(1); // polling resumes for the open ones
    await fns._ikFixRestore();
    expect(t.fresh.length).toBe(2); // once per intake state
  });
  it('a server without fixKey, or an error, leaves the screen as it was', async () => {
    const a = env(['_ikFixRestore', '_ikFixPoll'], { fresh: () => [row({})] });
    await a.fns._ikFixRestore();
    expect(a.I.fixes).toEqual({});
    const b = env(['_ikFixRestore', '_ikFixPoll'], { fresh: () => { throw Object.assign(new Error('Bad'), { status: 400 }); } });
    await b.fns._ikFixRestore();
    expect(b.I.fixes).toEqual({});
    expect(b.t.draws).toBe(0);
  });
  it('consent hub: every hub load asks (the old Tidy up screens did); the function itself asks once per intake state', () => {
    expect(extractFn(loadIndexHtml(), '_hubLoad')).toContain('_ikFixRestore();');
  });
});

describe('D7 a refusal that came after the user left shows on return (existing reason-only line)', () => {
  it('newest refused row per fixKey is restored and reads as the usual refused line', async () => {
    const at = new Date(Date.now() - 60000).toISOString();
    const fresh = (p: string) => (p.endsWith('consentFix') ? [{ id: P(91), type: 'consentFix', status: 'refused', reason: 'step-moved', detail: null, createdAt: at, fixKey: P(4) }]
      : [{ id: P(92), type: 'consentLink', status: 'refused', reason: null, detail: 'Only the admin can do this.', createdAt: at, fixKey: 'cn:' + P(1) },
        { id: P(93), type: 'consentLink', status: 'unclear', reason: null, detail: null, createdAt: at, fixKey: 'cn:' + P(2) }]);
    const { fns, I } = env(['_ikFixRestore', '_ikFixPoll', '_ikFixText', '_ikClText'], { fresh, extra: `const IK_FIX_REASON = ${HTML.match(/^const IK_FIX_REASON = (\{[\s\S]*?\});$/m)![1]};` });
    await fns._ikFixRestore();
    expect(fns._ikFixText(I.fixes[P(4)], null)).toEqual(['bad', 'Not sent: the profile changed in Elvanto. Search again.']);
    expect(fns._ikClText(I.fixes['cn:' + P(1)])).toEqual(['bad', 'Not saved: Only the admin can do this.']);
    expect(I.fixes['cn:' + P(2)]).toBeUndefined();
  });
});
