import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

// Fable review round, lane A, batch Y2. Runs the REAL functions from public/index.html with stubbed globals.
const html = loadIndexHtml();

/** The real functions, with every global they do not name in `env` answered by a stub that returns ''. */
function withStubs(names: string[], env: Record<string, any>): Record<string, any> {
  const g = new Proxy(env, {
    has: (t, k) => typeof k === 'string' && (k in t || (!names.includes(k) && !(k in globalThis))),
    get: (t, k) => (typeof k !== 'string' ? undefined : k in t ? t[k] : () => ''),
  });
  return new Function('__g', `with (__g) { ${names.map((n) => extractFn(html, n)).join('\n')}\nreturn { ${names.join(', ')} }; }`)(g);
}
const later = () => { let go!: (v?: any) => void; const p = new Promise<any>((r) => { go = r; }); return { p, go }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── Y2-1: the status pill is out of the flow ──
describe('Y2-1 the pill is not in #lk-top', () => {
  const queued = [{ kind: 'action', id: 'a1' }];
  const mk = (extra: Record<string, any> = {}) => {
    const els: Record<string, { innerHTML: string }> = { 'lk-top': { innerHTML: '' }, 'lk-pill': { innerHTML: '' } };
    const env = {
      LINK: { red: false, people: {}, gres: {}, fres: {}, mres: {}, flash: false }, S: { page: 'link-checkin' },
      _lkQGet: () => queued, _lkSay: (a: string) => a, _lkBanner: () => '<div class="lk-alert">banner</div>',
      esc: (x: string) => x, _lkOnPage: () => true, LK_DOOR_TYPES: [], _lkListHtml: () => '', _lkCiPoll: () => {},
      document: { getElementById: (id: string) => els[id] || null },
      ...extra,
    };
    return { fns: withStubs(['_lkPill', '_lkTop', '_lkPh', '_lkRefreshView'], env), els };
  };
  it('the HTML that fills #lk-top holds no lk-pill; the title-row host does', () => {
    const { fns } = mk();
    expect(fns._lkTop([])).not.toContain('lk-pill');
    expect(fns._lkTop([])).toContain('banner');
    const row = fns._lkPh('Check-in');
    expect(row).toContain('<h1>Check-in</h1>');
    expect(row).toContain('id="lk-pill"');
    expect(row).toContain('lk-pill wait');
  });
  it('a refresh repaints the pill host and leaves the banner host without a pill', () => {
    const { fns, els } = mk();
    fns._lkRefreshView();
    expect(els['lk-pill']!.innerHTML).toContain('lk-pill wait');
    expect(els['lk-top']!.innerHTML).not.toContain('lk-pill');
  });
});

// ── Y2-2: Cancel report asks first ──
describe('Y2-2 Cancel report asks first', () => {
  const groupEnv = (extra: Record<string, any> = {}) => {
    const pushed: any[] = [], asked: any[][] = [];
    const g = { groupId: 'g1', name: 'Grade 9 Girls', meets: 'Mon 7:00 PM' };
    const act: any = { id: 'a1', status: 'pending', type: 'submitReport' };
    const env: Record<string, any> = {
      pushed, asked, act, g,
      LINK: { gres: { g1: act }, gwk: 0 },
      esc: (x: any) => String(x), getMyLeaderId: () => 'L1',
      _lkGroup: () => g, _lkGroupAct: () => act, _lkPush: (it: any) => { pushed.push(it); },
      _lkAsk: (...a: any[]) => { asked.push(a); return Promise.resolve(env.answer); },
      answer: true,
      _lkWeeks: () => [{ start: '2026-11-23', end: '2026-11-29' }], _lkToday: () => '2026-11-24', _lkWeekReports: () => [], _lkReportDateFor: () => ({ state: 'later' }),
      lgDisplayName: (n: string) => n, _lkTint: () => '', _lkDay: (d: string) => d, _lkLastSeen: () => 0, _lkStatusTone: () => '', _lkStatusHtml: () => '', icS: () => '',
      ...extra,
    };
    return { env, fns: withStubs(['_lkGroupHtml', '_lkReportCancel'], env) };
  };
  it('the button reads Cancel report', () => {
    const { fns } = groupEnv();
    expect(fns._lkGroupHtml({ groupId: 'g1', name: 'Grade 9 Girls', meets: 'Mon' })).toMatch(/onclick="_lkReportCancel\(\)">Cancel report<\/button>/);
  });
  it('asks with its own title; No sends nothing', async () => {
    const { fns, env } = groupEnv(); env.answer = false;
    await fns._lkReportCancel();
    expect(env.asked).toEqual([['It has not reached Elvanto yet. Cancel it and lose the ticks and note?', 'Cancel report', 'Keep report', 'Cancel report?']]);
    expect(env.pushed).toEqual([]);
  });
  it('Yes queues one cancel item for that report', async () => {
    const { fns, env } = groupEnv(); env.answer = true;
    await fns._lkReportCancel();
    expect(env.pushed).toEqual([{ kind: 'cancel', id: 'a1', leaderId: 'L1', _g: 'g1' }]);
  });
  it('Yes after the report moved on (no longer pending) sends nothing', async () => {
    const { fns, env } = groupEnv();
    env.asked.length = 0;
    const p = fns._lkReportCancel();
    env.act.status = 'claimed';
    await p;
    expect(env.pushed).toEqual([]);
  });
});

// ── Y2-4: Sign out asks first ──
describe('Y2-4 Sign out asks first', () => {
  const outEnv = (o: { dirty?: boolean; queue?: any[]; answers?: Record<string, boolean>; logoutFails?: boolean } = {}) => {
    const asked: string[] = [], posts: string[] = [], held: Record<string, ReturnType<typeof later>> = {};
    let queue = o.queue || [];
    const env: Record<string, any> = {
      asked, posts, S: { user: { id: 'u1' }, page: 'home' }, _logoutBusy: false, rendered: 0,
      _setupDirty: () => !!o.dirty && env._setupDraft !== null, _setupDraft: 1, _setupClean: 1,
      _lkAsk: (text: string, _y: string, _n: string, title?: string) => { asked.push(title || text.slice(0, 20)); if (!held[title || '']) held[title || ''] = later(); return (o.answers && (title || '') in o.answers) ? Promise.resolve(o.answers[title || '']) : held[title || ''].p; },
      _lkQGet: () => queue, _lkSay: (a: string) => a, _lkActions: () => 'x', _lkUnsaved: () => 'y', _lkDrain: async () => { queue = []; }, _lkFlush: async () => {},
      _lkKey: () => 'k', _ikQLogout: async () => 0, _icLogout: async () => 0, _logoutLostText: () => '', _lkClear: () => {}, navReset: () => {},
      API: { token: 't', post: async (p: string) => { posts.push(p); if (o.logoutFails) throw new Error('dead token'); }, setToken: () => {} },
      document: { getElementById: () => null }, render: () => { env.rendered++; }, localStorage: { removeItem: () => {} }, sessionStorage: { removeItem: () => {} },
      _busLogoutReset: () => {}, nyReset: () => {}, _icClearLocal: () => {}, toast: () => {}, _vgReset: () => {},
      _arFilter: {}, _bdayFilter: {}, _prayerFilter: {},
    };
    return { env, held, fns: withStubs(['doLogout', '_setupLeaveAsk', '_lkLogoutGuard'], env) };
  };
  it('nothing queued: asks "Sign out?"; Stay never posts /auth/logout', async () => {
    const { env, held, fns } = outEnv();
    const p = fns.doLogout(); await tick();
    expect(env.asked).toEqual(['Sign out?']);
    held['Sign out?']!.go(false); await p;
    expect(env.posts).toEqual([]);
    expect(env.S.user).not.toBeNull();
  });
  it('Sign out proceeds and posts once', async () => {
    const { env, held, fns } = outEnv();
    const p = fns.doLogout(); await tick();
    held['Sign out?']!.go(true); await p;
    expect(env.posts).toEqual(['/auth/logout']);
    expect(env.S.user).toBeNull();
  });
  it('the question has its own title, text and buttons', async () => {
    const seen: any[] = [];
    const { env, held, fns } = outEnv();
    const orig = env._lkAsk; env._lkAsk = (...a: any[]) => { seen.push(a); return orig(...a); };
    const p = fns.doLogout(); await tick();
    expect(seen[0]).toEqual(['You will need to type the username and password again.', 'Sign out', 'Stay', 'Sign out?']);
    held['Sign out?']!.go(false); await p;
  });
  it('with unsent items only the existing unsent question is asked, never a second', async () => {
    const { env, fns } = outEnv({ queue: [{ kind: 'action' }], answers: { '': true } });
    await fns.doLogout();
    expect(env.asked.filter((t) => t === 'Sign out?')).toEqual([]);
    expect(env.posts).toEqual(['/auth/logout']);
  });
  it('after the Youth Setup guard\'s Discard there is no second question', async () => {
    const { env, fns } = outEnv({ dirty: true, answers: { 'Discard changes?': true } });
    fns.doLogout(); await tick(); await tick(); await tick();
    expect(env.asked).toEqual(['Discard changes?']);
    expect(env.posts).toEqual(['/auth/logout']);
  });
  it('Review Focus 2: two taps before an answer -> one question and one /auth/logout', async () => {
    const { env, held, fns } = outEnv();
    const a = fns.doLogout(), b = fns.doLogout(); await tick();
    expect(env.asked).toEqual(['Sign out?']);
    held['Sign out?']!.go(true); await Promise.all([a, b]);
    expect(env.posts).toEqual(['/auth/logout']);
  });
  it('Review Focus 2: a dead token still ends on the sign-in page', async () => {
    const { env, held, fns } = outEnv({ logoutFails: true });
    const p = fns.doLogout(); await tick();
    held['Sign out?']!.go(true); await p;
    expect(env.S.user).toBeNull();
    expect(env.rendered).toBe(1);
    // and the next sign-out is not stuck behind a flag
    env.S.user = { id: 'u2' };
    const q = fns.doLogout(); await tick();
    expect(env.asked.length).toBe(2);
    held['Sign out?']!.go(false); await q;
  });
});

// ── Y2-3: the typed name is selected after a check-in ──
describe('Y2-3 search text selected', () => {
  const run = (active: 'box' | 'other') => {
    const calls: any[][] = [];
    const box: any = { value: 'mia', setSelectionRange: (...a: any[]) => calls.push(a) };
    const env: Record<string, any> = {
      LINK: { svc: 's1', refusals: {}, doorAt: 0, doorHeld: null }, _lkSvc: () => ({ serviceId: 'sv' }), _lkSending: () => false,
      _lkQGet: () => [], _lkQueuedIdx: () => -1, _lkUuid: () => 'u1', _lkPush: () => {}, _lkTapToast: () => {}, getMyLeaderId: () => 'L1', _lkRefreshView: () => {},
      document: { getElementById: (id: string) => (id === 'lk-search' ? box : null), activeElement: active === 'box' ? box : {} },
    };
    const fns = withStubs(['_lkCheck', '_lkSelSearch'], env);
    fns._lkCheck('p1', 'checkIn');
    return calls;
  };
  it('the box is the active element: its whole value is selected', () => { expect(run('box')).toEqual([[0, 3]]); });
  it('another element is active: nothing is called on the box', () => { expect(run('other')).toEqual([]); });
  it('the box selects its whole value when it gets focus', () => {
    let shell = '';
    const env: Record<string, any> = { LINK: { services: [1], svc: 's1', q: { search: 'mia' } }, esc: (x: any) => String(x), _lkSvc: () => ({}), setApp: (h: string) => { shell = h; }, shell: (h: string) => h, _lkPh: () => '', _lkTop: () => '', _lkListHtml: () => '' };
    withStubs(['_lkPaintDoor'], env)._lkPaintDoor();
    const m = /id="lk-search"[^>]*onfocus="([^"]+)"/.exec(shell);
    expect(m).not.toBeNull();
    const calls: any[][] = [], el: any = { value: 'mia', setSelectionRange: (...a: any[]) => calls.push(a) };
    new Function('el', `(function(){ ${m![1]} }).call(el)`)(el);
    expect(calls).toEqual([[0, 3]]);
  });
});

// ── Y2-7: the decline toast lasts 5 s; the Home line opens Needs action ──
describe('Y2-7 decline message and the Home line', () => {
  const mark = async (outcome: string, markName = 'decline') => {
    const toasts: any[][] = [], I: any = {};
    const env: Record<string, any> = {
      toasts, _ik: () => I, _lkUuid: () => 'u1', _ikDraw: () => {}, _hubLoad: () => {}, _ikPost: async () => ({}), _ikOutcome: () => ({ outcome }),
      _ikQFind: () => null, toast: (...a: any[]) => toasts.push(a),
    };
    await withStubs(['_hubMarkRow'], env)._hubMarkRow('intake', '2026-11-24', 'k1', markName);
    return toasts;
  };
  it('a successful decline calls toast(..., 5000)', async () => {
    expect(await mark('saved')).toEqual([['Declined. Undo is under the Declined chip.', 5000]]);
  });
  it('the other messages keep the default time', async () => {
    expect((await mark('saved', 'undo'))[0]![1]).toBeUndefined();
    expect((await mark('refused'))[0]![1]).toBeUndefined();
  });
  it('the Home line\'s action then _hubBodyHtml() shows Needs action open', () => {
    const I: any = { hubOpen: {}, hubQ: '' };
    const env: Record<string, any> = {
      _ik: () => I, esc: (x: any) => String(x), icS: () => '', _ikSt: () => ({}), _hubM: () => ({ fams: [], declined: [], loose: [] }), _hubRows: () => [], _hubWk: () => 'all', _siteDay: () => '2026-11-24',
      _hubInWeek: () => true, _hubAddDays: () => '2026-10-27', _hubBulkBtn: () => '', _hubBulkHtml: () => '', _hubSendHtml: () => '', HUB_STAGES: [],
      _seen: {}, _attnSeen: () => ({}), _modOn: () => true,
    };
    const f = withStubs(['_ikOpenNeed', '_hubBodyHtml', '_attnHtml', '_attnLines'], env);
    const a = { role: 'admin', errors: 0, unsent: 0, unclear: 0, waiting: 0, offlineAt: 0, dnc: 0, fix: [], needsYou: 1 };
    const line = f._attnHtml(a);
    const m = /onclick="([^"]*link-intake[^"]*)"/.exec(line);
    expect(m).not.toBeNull();
    expect(f._hubBodyHtml()).toMatch(/<details class="lk-done" ontoggle="_hubToggle\('need'/); // collapsed by default (consent-hub pin)
    new Function('_ikOpenNeed', 'go', m![1]!)(f._ikOpenNeed, () => {});
    expect(f._hubBodyHtml()).toContain('<details class="lk-done" open ontoggle="_hubToggle(\'need\'');
  });
});
