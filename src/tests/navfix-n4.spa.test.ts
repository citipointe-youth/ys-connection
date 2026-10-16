// Fix round 2026-10-16 lane n4 (SPA): Unsent retry busy (C-B2), New person result kept (C-B5),
// New person request id + unsent marker (C-B9/D3), door wording (B10, D6), _lkBoot intake flush.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();
const fns = (names: string[]) => names.map((n) => extractFn(html, n)).join('\n');

describe('C-B2 Unsent retry: a re-render during the retry keeps the button busy', () => {
  function setup(post: () => Promise<any>) {
    const els: Record<string, any> = {};
    const env: any = { toasts: [] as string[], loads: 0 };
    const f = new Function('env', 'els', 'post', `
      const document = { getElementById: (id) => els[id] || null };
      const esc = (s) => String(s), _laFmtBrisbane = (s) => s, _laRelTime = (s) => s;
      const toast = (m) => env.toasts.push(m), _nyMessage = () => ({ lines: ['ok'] });
      const API = { post };
      const US_REASON = {};
      const _usBusy = new Set();
      let _usRows = [{ id: 'u1', name: 'A B', reason: 'failed', forms: ['student'], createdAt: 'x', updatedAt: 'x' }];
      async function _usLoad() { env.loads++; }
      ${extractFn(html, '_usRowHtml')}
      ${extractFn(html, 'usRetry')}
      return { _usRowHtml, usRetry, rows: () => _usRows };`);
    return { ...f(env, els, post), env, els };
  }

  it('row drawn while a retry is in flight has a disabled Sending... button; after the reply it is enabled', async () => {
    let done!: (v: any) => void;
    const t = setup(() => new Promise((r) => { done = r; }));
    t.els['us-retry-u1'] = { disabled: false, dataset: {}, textContent: 'Retry' };
    const p = t.usRetry('u1');
    const mid = t._usRowHtml(t.rows()[0]);
    expect(mid).toMatch(/id="us-retry-u1"[^>]*disabled/);
    expect(mid).toContain('Sending...');
    // a fresh button (re-render) tapped again: ignored, no second POST
    t.els['us-retry-u1'] = { disabled: false, dataset: {}, textContent: 'Retry' };
    let posts = 0;
    await t.usRetry('u1').then(() => posts++);
    expect(t.env.loads).toBe(0); // the second tap returned before posting/reloading
    done({ student: 'sent', parent: 'sent' });
    await p;
    const after = t._usRowHtml(t.rows()[0]);
    expect(after).not.toMatch(/disabled/);
    expect(after).toContain('>Retry<');
    expect(posts).toBe(1);
  });
  it('the busy set is declared at top level', () => {
    expect(html).toMatch(/^const _usBusy = new Set\(\);/m);
  });
});

// The real New person functions against small stubs (pattern from new-youth.spa.test.ts).
const NY_FNS = ['_nyModeOf', '_nyMode', '_nyOn', '_nyDobMask', '_nyDobIso', '_nyDobShow', '_nyDobError', '_nyToday', '_nyDobProblem', '_nyHost', '_nyHostHtml', '_nyHostDraw', '_nyPickHost', '_nyMessage', '_nyErrorText', 'toAuMobile', 'tidyName', '_nyFieldMsgs', '_nyRaw', '_nyShowMsgs', 'nySend', 'nyReset', 'nyOpen', 'nyBack', 'nySibling', 'renderNewYouth'];
function nyHarness(post: (path: string, body: any, ...rest: any[]) => Promise<any>, store: Record<string, string> = {}) {
  const S: any = { user: { id: 'u1', role: 'admin' }, page: 'new-youth', settings: { ministryConfig: { modules: { newYouthForms: 'on' } } } };
  const pages: string[] = [];
  const toasts: string[] = [];
  const button: any = { disabled: false, textContent: 'Send to Elvanto', isConnected: true };
  const body = { host: 'H', firstName: 'Alex', lastName: 'T', dob: '2012-04-03', gender: 'm', grade: '8', school: 'S', mobile: '0412345678', parentFirst: 'P', parentLast: 'T', parentMobile: '0498765432' };
  const ref: any = {};
  const ls = { getItem: (k: string) => (k in store ? store[k]! : null), setItem: (k: string, v: string) => { store[k] = String(v); }, removeItem: (k: string) => { delete store[k]; } };
  const doc = { getElementById: (id: string) => (id === 'ny-send' ? button : null), querySelector: () => null };
  const factory = new Function('S', 'API', 'toast', 'document', 'localStorage', 'setApp', 'shell', 'esc', 'go', 'window', '_nyRead', 'NY_ALLERGIES', 'NY_CONDITIONS',
    'getMyLeaderId', '_lkMyName', '_lkIamPick', '_gradeList', 'NY_ERR_IDS', 'navigator',
    `let NY = { keep: null, sibling: false, sending: false, result: null, last: null, error: null, unknown: false };
    ${fns(NY_FNS)}
    return { nySend, nyOpen, nyReset, nyBack, renderNewYouth, get NY() { return NY; }, set NY(v) { NY = v; } };`);
  const h = factory(S, { post }, (m: string) => toasts.push(m), doc, ls,
    (x: string) => pages.push(x), (x: string) => x, (x: any) => String(x), (p: string) => { S.page = p; if (p === 'new-youth') ref.h.renderNewYouth(); }, { scrollTo() {} },
    () => ({ ...body }), [], [], () => 'L1', () => 'H', () => {}, () => [7, 8, 9, 10, 11, 12], ['mobile'], { onLine: true });
  ref.h = h;
  return { h, S, pages, toasts, store, body, last: () => pages[pages.length - 1] ?? '' };
}

describe('C-B5 an unseen New person outcome survives reopening New person', () => {
  it('unknown outcome arrives off the page; reopening shows it, not a blank form; once seen, reopening resets', async () => {
    const t = nyHarness(async () => { throw Object.assign(new Error('Bad Gateway'), { status: 502 }); });
    t.S.page = 'home';
    await t.h.nySend({ preventDefault() {} });
    expect(t.h.NY.unknown).toBe(true);
    t.S.page = 'home';
    t.h.nyOpen();
    expect(t.h.NY.unknown).toBe(true);
    expect(t.last()).toMatch(/Check the forms list in Elvanto before sending again/);
    t.S.page = 'home';
    t.h.nyOpen(); // now seen: a fresh form
    expect(t.h.NY.unknown).toBe(false);
    expect(t.last()).toContain('id="ny-send"');
  });
  it('a result arriving off the page is kept the same way', async () => {
    const t = nyHarness(async () => ({ student: 'sent', parent: 'unconfirmed', dryRun: false }));
    t.S.page = 'home';
    await t.h.nySend({ preventDefault() {} });
    t.h.nyOpen();
    expect(t.last()).toMatch(/Parent form was sent, but Elvanto didn't confirm it/);
  });
  it('a second send after a seen result is not treated as seen', async () => {
    const t = nyHarness(async () => ({ student: 'sent', parent: 'sent', dryRun: false }));
    await t.h.nySend({ preventDefault() {} }); // on the page: seen
    t.h.nyBack();
    t.S.page = 'home';
    await t.h.nySend({ preventDefault() {} }); // reply off the page
    t.h.nyOpen();
    expect(t.last()).toContain('Student form is in Elvanto.');
  });
});
