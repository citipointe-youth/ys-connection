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
