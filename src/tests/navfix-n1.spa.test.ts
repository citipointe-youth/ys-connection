// navfix n1 (SPA): late-reply guards, notices unsent draft, nav back guards, small shell fixes.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const fns = (names: string[]) => names.map((n) => extractFn(HTML, n)).join('\n');
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── C-B6: notices send ──
function notices(opts: { post?: (b: any) => Promise<any> } = {}) {
  const env: any = { store: {} as Record<string, string>, posts: [] as any[], renders: 0, toasts: [] as string[], app: '' };
  const f = new Function('env', `
    var S = { page: 'notices', user: { id: 'u1', role: 'admin' } }, _ntBusy = null;
    var localStorage = { getItem: (k) => (k in env.store ? env.store[k] : null), setItem: (k, v) => { env.store[k] = String(v); }, removeItem: (k) => { delete env.store[k]; } };
    var API = { post: (p, b, t, q, k) => { env.posts.push({ p, b, k, stored: env.store['ysc.ntDraft.u1'] }); return env.post ? env.post(b) : Promise.resolve({ id: b.requestId }); }, get: async () => [] };
    var Cache = { del: () => {}, getStale: () => [] };
    var toast = (m) => env.toasts.push(m);
    var _here = () => ({ p: S.page }), _still = (h) => h.p === S.page;
    var _lkUuid = () => 'rid-' + (++env.n);
    var esc = (s) => String(s).replace(/</g, '&lt;');
    var _noticeSender = () => true;
    var _noticesHtml = () => '<div class="ph"></div><div id="nt-push"></div><LIST>';
    var shell = (h) => h, setApp = (h) => { env.app = h; }, _ntPushDraw = () => {};
    var document = { getElementById: (id) => env.dom[id] || null, querySelectorAll: () => env.checks || [] };
    ${fns(['_ntKey', '_ntDraftGet', '_ntDraftSet', '_ntSend', 'submitNotice', 'ntResend', 'ntDiscard', 'renderNotices'])}
    var realRender = renderNotices;
    renderNotices = function () { env.renders++; return realRender(); };
    return { S, submitNotice, ntResend, ntDiscard, renderNotices: realRender };`);
  env.n = 0;
  env.post = opts.post;
  env.dom = { 'nt-title': { value: 'Bus late' }, 'nt-body': { value: 'Leave at 9' }, 'nt-send': { disabled: false } };
  env.checks = [{ checked: true, value: 'b79' }];
  return { ...f(env), env };
}

describe('C-B6 notices send', () => {
  it('draft persisted before the POST (keepalive), cleared on success, list repainted while still on Notices', async () => {
    const t = notices();
    await t.submitNotice();
    expect(t.env.posts[0].k).toBe(true);
    expect(JSON.parse(t.env.posts[0].stored)).toMatchObject({ requestId: 'rid-1', title: 'Bus late', recipients: ['b79'] });
    expect(t.env.posts[0].b.requestId).toBe('rid-1');
    expect(t.env.store['ysc.ntDraft.u1']).toBeUndefined();
    expect(t.env.renders).toBe(1);
  });
  it('user moved to another page mid-POST -> renderNotices not called', async () => {
    let done: any; const t = notices({ post: () => new Promise((r) => { done = r; }) });
    const p = t.submitNotice();
    t.S.page = 'home';
    done({ id: 'rid-1' }); await p;
    expect(t.env.renders).toBe(0);
    expect(t.env.toasts).toContain('Notice sent');
  });
  it('network error keeps the draft; Notices shows "Not sure this went" with Send again (same id) and Discard', async () => {
    const t = notices({ post: () => Promise.reject(Object.assign(new Error('offline'), { status: undefined })) });
    await t.submitNotice();
    expect(t.env.store['ysc.ntDraft.u1']).toBeTruthy();
    await t.renderNotices();
    expect(t.env.app).toContain('Not sure this went');
    expect(t.env.app).toContain('Bus late');
    expect(t.env.app.indexOf('nt-push')).toBeLessThan(t.env.app.indexOf('Not sure'));
    t.env.post = (b: any) => Promise.resolve({ id: b.requestId });
    await t.ntResend();
    expect(t.env.posts[1].b.requestId).toBe('rid-1');
    expect(t.env.store['ysc.ntDraft.u1']).toBeUndefined();
  });
  it('a 4xx refusal clears the draft (nothing was saved)', async () => {
    const t = notices({ post: () => Promise.reject(Object.assign(new Error('bad'), { status: 400 })) });
    await t.submitNotice();
    expect(t.env.store['ysc.ntDraft.u1']).toBeUndefined();
    expect(t.env.dom['nt-send'].disabled).toBe(false);
  });
  it('Discard removes the draft; no banner while that send is in flight', async () => {
    let done: any; const t = notices({ post: () => new Promise((r) => { done = r; }) });
    const p = t.submitNotice();
    await t.renderNotices();
    expect(t.env.app).not.toContain('Not sure');
    done({}); await p;
    t.env.store['ysc.ntDraft.u1'] = JSON.stringify({ requestId: 'x', title: '$& t', body: 'b', recipients: ['b79'] });
    await t.renderNotices();
    expect(t.env.app).toContain('$& t');
    t.ntDiscard();
    expect(t.env.store['ysc.ntDraft.u1']).toBeUndefined();
  });
});

// ── C-B7: CA saveAudit ──
function audit() {
  const env: any = { posts: 0, renders: [] as string[], toasts: [] as string[], btn: { disabled: false } };
  const f = new Function('env', `
    var S = { page: 'ca-data' };
    var PENDING = { service: { rows: [] }, group: null, team: [], connect: [], decision: [], flows: [] }, AUDIT = null;
    var API = { post: () => { env.posts++; return env.post ? env.post() : Promise.resolve({ year: 2026 }); } };
    var auditInvalidate = () => {}, auditList = async () => {}, auditLoad = async () => {};
    var toast = (m) => env.toasts.push(m), render = async (p) => { env.renders.push(p); };
    var _here = () => ({ p: S.page }), _still = (h) => h.p === S.page;
    var document = { querySelector: () => env.btn };
    ${fns(['saveAudit'])}
    return { S, saveAudit, PENDING: () => PENDING };`);
  return { ...f(env), env };
}

describe('C-B7 CA saveAudit', () => {
  it('still on the screen -> goes to Audit Overview', async () => {
    const t = audit();
    await t.saveAudit();
    expect(t.env.renders).toEqual(['ca-overview']);
    expect(t.env.btn.disabled).toBe(false);
  });
  it('user went elsewhere mid-save -> no render, toast only', async () => {
    let done: any; const t = audit(); t.env.post = () => new Promise((r) => { done = r; });
    const p = t.saveAudit();
    t.S.page = 'home';
    done({ year: 2026 }); await p;
    expect(t.env.renders).toEqual([]);
    expect(t.env.toasts).toContain('Audit saved for 2026');
  });
  it('second tap while saving -> returns, one POST; button disabled while saving', async () => {
    let done: any; const t = audit(); t.env.post = () => new Promise((r) => { done = r; });
    const p = t.saveAudit();
    expect(t.env.btn.disabled).toBe(true);
    await t.saveAudit();
    expect(t.env.posts).toBe(1);
    done({ year: 2026 }); await p;
    expect(t.env.btn.disabled).toBe(false);
    await t.saveAudit();
    expect(t.env.posts).toBe(1); // PENDING cleared after a save: nothing to send
  });
});

// ── C-B8: bus sheets closed only if still the same sheet ──
function bus() {
  const env: any = { closes: 0, mo: { id: 'bulk' }, toasts: [] as string[] };
  const f = new Function('env', `
    var BUS = { bulk: [{ on: true, studentId: 's1', name: 'A', addr: {} }, { on: true, studentId: 's2', name: 'B', addr: {} }], bulkBusy: false, _emcOrder: [], _emcRemoved: [] };
    var _busBlockWrite = () => false, _busBulkCount = () => {}, _busQs = () => '', busRefresh = async () => {};
    var API = { post: () => (env.post ? env.post() : Promise.resolve({})) };
    var _busSend = () => (env.post ? env.post() : Promise.resolve({}));
    var closeModal = () => { env.closes++; }, toast = (m) => env.toasts.push(m);
    var _here = () => ({ mo: env.mo }), _stillSheet = (h) => !!h.mo && h.mo === env.mo;
    var document = { getElementById: () => null };
    ${fns(['busBulkSave', 'busSaveMyCarStops'])}
    return { busBulkSave, busSaveMyCarStops };`);
  return { ...f(env), env };
}

describe('C-B8 bus sheet close', () => {
  it('busBulkSave: same sheet -> closes; another sheet opened mid-loop -> left open', async () => {
    const a = bus(); await a.busBulkSave(); expect(a.env.closes).toBe(1);
    const b = bus(); b.env.post = () => { b.env.mo = { id: 'edit-rider' }; return Promise.resolve({}); };
    await b.busBulkSave();
    expect(b.env.closes).toBe(0);
    expect(b.env.toasts).toContain('2 added');
  });
  it('busSaveMyCarStops: same sheet -> closes; sheet swapped -> left open', async () => {
    const a = bus(); await a.busSaveMyCarStops(); expect(a.env.closes).toBe(1);
    const b = bus(); b.env.post = () => { b.env.mo = null; return Promise.resolve({}); };
    await b.busSaveMyCarStops();
    expect(b.env.closes).toBe(0);
    expect(b.env.toasts).toContain('Saved');
  });
});
