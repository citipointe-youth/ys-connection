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

describe('C-B9/D3 New person request id + unsent marker', () => {
  const KEY = 'ysc.nyReq.u1';
  it('the marker is written BEFORE the POST, the POST carries its id with keepalive, and a definite reply clears it', async () => {
    let seen: any = null;
    const t = nyHarness(async (_p, body, ms, quiet, keep) => {
      seen = { body, ms, quiet, keep, stored: JSON.parse(t.store[KEY]!) };
      return { student: 'sent', parent: 'sent', dryRun: false };
    });
    await t.h.nySend({ preventDefault() {} });
    expect(seen.stored.id).toBe(seen.body.requestId);
    expect(seen.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen.stored.first).toBe('Alex');
    expect(seen.stored).not.toHaveProperty('lastName');
    expect(seen.ms).toBe(45000);
    expect(seen.keep).toBe(true);
    expect(t.store[KEY]).toBeUndefined();
  });
  it('an unknown outcome keeps the marker; the same person sent again reuses the id', async () => {
    const bodies: any[] = [];
    const t = nyHarness(async (_p, body) => { bodies.push(body); throw Object.assign(new Error('x'), { status: 502 }); });
    await t.h.nySend({ preventDefault() {} });
    expect(JSON.parse(t.store[KEY]!).id).toBe(bodies[0].requestId);
    t.h.nyBack();
    await t.h.nySend({ preventDefault() {} });
    expect(bodies[1].requestId).toBe(bodies[0].requestId);
  });
  it('a different person, or a marker over 24 h old, gets a new id', async () => {
    const bodies: any[] = [];
    const t = nyHarness(async (_p, body) => { bodies.push(body); throw Object.assign(new Error('x'), { status: 502 }); });
    await t.h.nySend({ preventDefault() {} });
    const m = JSON.parse(t.store[KEY]!);
    t.store[KEY] = JSON.stringify({ ...m, at: Date.now() - 25 * 3600e3 });
    t.h.nyBack();
    await t.h.nySend({ preventDefault() {} });
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
    t.store[KEY] = JSON.stringify({ ...m, h: 'other' });
    t.h.nyBack();
    await t.h.nySend({ preventDefault() {} });
    expect(bodies[2].requestId).not.toBe(bodies[0].requestId);
  });
  it('a refusal before any POST clears the marker (nothing was sent)', async () => {
    const t = nyHarness(async () => { throw Object.assign(new Error('Check the parent mobile'), { status: 400, code: 'BAD_REQUEST' }); });
    await t.h.nySend({ preventDefault() {} });
    expect(t.store[KEY]).toBeUndefined();
  });
  it('the form page warns about an unfinished send on this phone, with Dismiss', () => {
    const t = nyHarness(async () => ({}), { [KEY]: JSON.stringify({ id: 'x', first: 'Alex', h: 'h', at: Date.now() }) });
    t.h.renderNewYouth();
    expect(t.last()).toMatch(/A send for Alex at .+ didn't finish on this phone\. Check Elvanto before sending again\./);
    expect(t.last()).toContain('Dismiss');
    expect(extractFn(html, '_nyReqDismiss')).toContain('renderNewYouth');
  });
  it('storage that throws never blocks a send', async () => {
    let posted = 0;
    const no = () => { throw new Error('denied'); };
    const t = nyHarness(async () => { posted++; return { student: 'sent', parent: 'sent', dryRun: false }; }, {}, { getItem: no, setItem: no, removeItem: no });
    await t.h.nySend({ preventDefault() {} });
    expect(posted).toBe(1);
  });
});

const LK_CONSTS = ['LK_MEM_TYPES', 'LK_FLOW_TYPES', 'LK_OFFLINE_MS'].map((n) => html.match(new RegExp(`^const ${n} = .*;`, 'm'))![0]).join('\n');

describe('B10 leaders are told "Tell the admin", not "Do it in Elvanto"', () => {
  function results(role: string) {
    const toasts: string[] = [];
    const f = new Function('toasts', `
      ${LK_CONSTS}
      const S = { user: { role: ${JSON.stringify(role)} } };
      const LINK = { loadGen: 1, refusals: {}, gmOpen: {}, mres: {} };
      const toast = (m) => toasts.push(m);
      const _lkQGet = () => [], _lkQSet = () => {}, _lkApply = () => {}, _lkMembersLoad = () => {}, _lkSchedule = () => {}, _lkRefreshView = () => {};
      ${fns(['_lkBoss', '_lkResults'])}
      return _lkResults;`)(toasts);
    return { run: f, toasts };
  }
  const SVC = 's1', PID = 'p1';
  it('a refused check-out toast from the server message', () => {
    for (const [role, want] of [['grade', "They aren't in a room. Tell the admin."], ['leader', "They aren't in a room. Tell the admin."], ['admin', "They aren't in a room. Do it in Elvanto."]]) {
      const t = results(role!);
      t.run([{ kind: 'action', id: 'a1', type: 'checkOut', payload: { serviceTimeId: SVC, personId: PID } }],
        [{ kind: 'action', id: 'a1', outcome: 'refused', reason: 'x', message: "They aren't in a room. Do it in Elvanto." }]);
      expect(t.toasts).toEqual([want]);
    }
  });
  it('a too-late undo / cancel', () => {
    const t = results('quad');
    t.run([{ kind: 'undo', id: 'u1' }], [{ kind: 'undo', id: 'u1', outcome: 'too-late' }]);
    expect(t.toasts).toEqual(['Already sent. Tell the admin.']);
    const a = results('director');
    a.run([{ kind: 'undo', id: 'u1' }], [{ kind: 'undo', id: 'u1', outcome: 'too-late' }]);
    expect(a.toasts).toEqual(['Already sent. Do it in Elvanto.']);
  });
  it('the locked line in the screen banner', () => {
    const banner = (role: string) => new Function(`
      const S = { user: { role: ${JSON.stringify(role)} } };
      const esc = (s) => String(s), icS = () => '', _lkSeen = () => '', _lkOfflineSince = () => '';
      ${fns(['_lkBoss', '_lkBanner'])}
      return _lkBanner(['checkOut'], { console: { online: true, capabilities: { checkOut: 'locked' } } });`)();
    expect(banner('grade')).toContain("Check-out: this isn't connected yet. Tell the admin.");
    expect(banner('grade')).not.toContain('Do it in Elvanto');
    expect(banner('admin')).toContain("Check-out: this isn't connected yet. Do it in Elvanto.");
  });
});

describe('D6 door: a pending row over 15 min says the console has not picked it up', () => {
  const st = new Function(`
    ${LK_CONSTS}
    const _lkOutsideWindow = () => false, _lkPracticeLine = () => '';
    const _lkSeen = (iso) => 'SEEN(' + iso + ')';
    ${extractFn(html, '_lkStatusText')}
    return _lkStatusText;`)();
  it('16 min old -> since line; 5 min old -> the normal pending line; awaiting-approval unchanged', () => {
    const old = new Date(Date.now() - 16 * 60000).toISOString();
    expect(st({ status: 'pending', reason: null, createdAt: old }, '7:02 pm')).toBe(`Console hasn't picked this up yet (since SEEN(${old})).`);
    expect(st({ status: 'pending', reason: null, createdAt: new Date(Date.now() - 5 * 60000).toISOString() })).toBe('Waiting for the console.');
    expect(st({ status: 'pending', reason: 'awaiting-approval', createdAt: old })).toBe('Waiting for the new-person form to be approved.');
  });
  it('N02: console online -> the _ikChip "Queued" line, not "hasn\'t picked this up"', () => {
    const on = new Function(`
      ${LK_CONSTS}
      const LINK = { status: { console: { online: true } } };
      const _lkOutsideWindow = () => false, _lkPracticeLine = () => '', _lkSeen = (iso) => 'SEEN(' + iso + ')';
      ${extractFn(html, '_lkStatusText')}
      return _lkStatusText;`)();
    const old = new Date(Date.now() - 16 * 60000).toISOString();
    expect(on({ status: 'pending', reason: null, createdAt: old })).toBe('Queued behind other saves.');
  });
});

describe('_lkBoot flushes the intake queue when n2 is present', () => {
  it('calls _ikQFlush once when it exists; absent is fine', () => {
    const boot = (withFlush: boolean) => {
      const calls: string[] = [];
      new Function('calls', `
        const S = { user: { id: 'u1' } }; const LINK = {};
        const localStorage = { length: 0, key: () => null, getItem: () => null, removeItem: () => {} };
        const _lkKey = () => 'ysc.lkq.u1', _lkQGet = () => [], _lkSchedule = () => {};
        ${withFlush ? "function _ikQFlush() { calls.push('flush'); }" : ''}
        ${extractFn(html, '_lkBoot')}
        _lkBoot(); _lkBoot();`)(calls);
      return calls;
    };
    expect(boot(true)).toEqual(['flush']);
    expect(boot(false)).toEqual([]);
  });
});
