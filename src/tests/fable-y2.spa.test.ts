import { describe, it, expect, vi } from 'vitest';
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
      _lkAsk: (text: string, _y: string, _n: string, title?: string) => { asked.push(title || text.slice(0, 20)); if (!held[title || '']) held[title || ''] = later(); return (o.answers && (title || '') in o.answers) ? Promise.resolve(o.answers[title || '']) : held[title || '']!.p; },
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
    expect(env.asked.filter((t: string) => t === 'Sign out?')).toEqual([]);
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

// ── Y2-8: Home updates the Bus tile and the New people card in place ──
describe('Y2-8 Home stops repainting for the Bus tile', () => {
  const mk = (withHosts = true) => {
    const calls = { renderHome: 0, setApp: 0 }, hosts: Record<string, { outerHTML: string }> = withHosts ? { 'bus': { outerHTML: '' }, 'bus-np': { outerHTML: '' } } : {};
    const BUS: any = { loading: null, loadingAs: null, gen: 0, view: null, failed: false, pending: null, pendingLoading: null, routeMin: {}, tab: 'roster' };
    const env: Record<string, any> = {
      BUS, calls, hosts, S: { user: { id: 'u1' }, page: 'home' }, getMyLeaderId: () => 'L1', _busTripQs: () => '', _modOn: () => false, _busOn: () => true,
      _busGet: async (p: string) => (p === '/bus/run' ? { run: { id: 'r1', version: 3 }, vehicles: [{ running: true }], riders: [1, 2], pendingNewPeople: 1 }
        : p === '/bus/guests/pending' ? [{ id: 'g1', name: 'Sample Guest', suggestions: [], createdAt: '2026-11-20', grade: 9, phone: null }] : {}),
      renderHome: () => { calls.renderHome++; }, setApp: () => { calls.setApp++; }, toast: () => {}, esc: (x: any) => String(x), L: (k: string) => k, icN: () => '', icS: () => '', fmtDay: (d: string) => d,
      document: { querySelector: (sel: string) => hosts[sel.replace('[data-home=', '').replace(']', '')] || null },
    };
    const fns = withStubs(['busRefresh', '_busLoadPending', '_busHomeUpdate', '_busHomeTile', '_busNewPeopleCard'], env);
    return { fns, calls, hosts, BUS };
  };
  it('a landed busRefresh calls neither renderHome nor setApp, and fills the tile host', async () => {
    const { fns, calls, hosts } = mk();
    await fns.busRefresh();
    expect(calls.renderHome).toBe(0);
    expect(calls.setApp).toBe(0);
    expect(hosts['bus']!.outerHTML).toContain('2 riders');
    expect(hosts['bus']!.outerHTML).toContain('data-home="bus"');
  });
  it('a landed _busLoadPending calls neither, and fills the New people host', async () => {
    const { fns, calls, hosts, BUS } = mk();
    BUS.view = { run: { id: 'r1' }, vehicles: [], riders: [], pendingNewPeople: 1 };
    await fns._busLoadPending();
    expect(calls.renderHome).toBe(0);
    expect(calls.setApp).toBe(0);
    expect(hosts['bus-np']!.outerHTML).toContain('Sample Guest');
    expect(hosts['bus-np']!.outerHTML).toContain('data-home="bus-np"');
  });
  it('busRefresh brings the New people list (the card asks for it once the count lands)', async () => {
    const { fns, hosts } = mk();
    await fns.busRefresh(); await tick(); await tick();
    expect(hosts['bus-np']!.outerHTML).toContain('Sample Guest');
  });
  it('with no host on the page (Home not painted yet) it still repaints Home, as before', async () => {
    const { fns, calls } = mk(false);
    await fns.busRefresh();
    expect(calls.renderHome).toBe(1);
  });
  it('the paint carries both hosts', () => {
    const { fns, BUS } = mk();
    BUS.view = { run: { id: 'r1' }, vehicles: [], riders: [], pendingNewPeople: 0 };
    expect(fns._busHomeTile()).toContain('data-home="bus"');
    expect(fns._busNewPeopleCard()).toBe('<div data-home="bus-np"></div>');
  });
});

// ── Y2-9: My Connections paints at once ──
describe('Y2-9 My Connections paints from the last-known list first', () => {
  const cacheSrc = (() => { const i = html.indexOf('const Cache = (() => {'); return html.slice(i, html.indexOf('\n})();', i) + 6); })();
  const SUM = '/connections/leader/L1/summary';
  const mk = (seed: { summary?: any; prayers?: any }) => {
    const Cache = new Function(`${cacheSrc}\nreturn Cache;`)();
    // the stale copies: set, then let them lapse (Cache.get null, getStale still answers)
    const gate: Record<string, ReturnType<typeof later>> = {};
    const paints: string[] = [];
    const env: Record<string, any> = {
      Cache, paints, gate, S: { page: 'my-students', user: { role: 'admin' } }, _msLeader: 'L1', _lvF: { year: new Set(), gender: new Set() },
      API: {
        get: (p: string) => { const c = Cache.get(p); if (c !== null) return Promise.resolve(c); gate[p] ||= later(); return gate[p]!.p.then((d: any) => { Cache.set(p, d); return d; }); },
        batch: (ps: string[]) => Promise.all(ps.map((p) => env.API.get(p).catch(() => null))),
      },
      setApp: (h: string) => { paints.push(h); }, shell: (h: string) => h, icN: () => '', icS: () => '', icEmpty: () => '', esc: (x: any) => String(x == null ? '' : x), L: (k: string) => k,
      getMyLeaderId: () => 'L1', _gradeList: () => [7, 8, 9], quadGrades: () => [], _prayersOn: () => true, dncChip: () => '', riskChip: () => '', phoneLink: () => '', termRow: () => '', fmtBday: () => '',
      _smsTemplateBoxHtml: () => '', _lkSwitchLeader: async () => true, _myStudentsRevalidating: false, MYSTUDENTS_PATHS: ['/leaders?pick=1', '/students'],
    };
    const put = (p: string, d: any) => { Cache.set(p, d); };
    put('/leaders?pick=1', [{ id: 'L1', fullName: 'Sam Example', grades: [9], gender: 'female' }]); put('/students', []);
    if (seed.summary) put(SUM, seed.summary);
    if (seed.prayers) put('/prayers', seed.prayers);
    const real = Date.now; // advance() moves the clock past the 30 s TTL: every seeded entry is then stale (getStale still answers)
    return { env, fns: withStubs(['renderMyStudents', '_revalidateMyStudents', '_msPaths'], env), Cache, restore: () => { Date.now = real; }, advance: () => { Date.now = () => real() + 120000; } };
  };
  const sum = (name: string) => ({ students: [{ id: 's1', fullName: name, firstName: name, grade: 9, gender: 'female', svcAttended: 1, svcTotal: 2, prevSvcAttended: 0, prevSvcTotal: 0, grpAttended: 0, grpTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0 }] });
  it('stale summary and prayers cached, network held: painted at once with the cached student, repainted with the fresh one', async () => {
    const h = mk({ summary: sum('Cached Sample'), prayers: [] });
    h.advance();
    try {
      const p = h.fns.renderMyStudents();
      await tick();
      expect(h.env.paints.length).toBeGreaterThanOrEqual(1);
      expect(h.env.paints[0]).toContain('Cached Sample');
      for (const k of Object.keys(h.env.gate)) h.env.gate[k].go(k === SUM ? sum('Fresh Sample') : k === '/prayers' ? [] : k === '/students' ? [] : [{ id: 'L1', fullName: 'Sam Example', grades: [9], gender: 'female' }]);
      await p; await tick(); await tick(); await tick();
      expect(h.env.paints[h.env.paints.length - 1]).toContain('Fresh Sample');
    } finally { h.restore(); }
  });
  it('nothing cached: the header and picker are painted first, then the list', async () => {
    const h = mk({});
    const p = h.fns.renderMyStudents();
    await tick();
    expect(h.env.paints.length).toBe(1);
    expect(h.env.paints[0]).toContain('My Connections');
    expect(h.env.paints[0]).toContain('Who are you?');
    expect(h.env.paints[0]).not.toContain('Fresh Sample');
    h.env.gate[SUM].go(sum('Fresh Sample')); h.env.gate['/prayers'].go([]);
    await p;
    expect(h.env.paints[h.env.paints.length - 1]).toContain('Fresh Sample');
  });
  it('a page change during the await: no later paint', async () => {
    const h = mk({});
    const p = h.fns.renderMyStudents();
    await tick();
    const before = h.env.paints.length;
    h.env.S.page = 'home';
    h.env.gate[SUM].go(sum('Fresh Sample')); h.env.gate['/prayers'].go([]);
    await p;
    expect(h.env.paints.length).toBe(before);
  });
  it('the revalidate reads the summary and prayers too', async () => {
    const h = mk({});
    h.env.S.page = 'home';
    h.fns._revalidateMyStudents(); await tick();
    expect(Object.keys(h.env.gate).sort()).toEqual(['/prayers', SUM].sort());
  });
});

// ── Y2-10: a kept intake field keeps its row and can be un-kept ──
describe('Y2-10 Undo keep for every kept field', () => {
  const mk = (kept: string[], mem: Record<string, string> = {}) => {
    const detail: any = { kept, forms: { student: { subId: 'S1', issues: [], values: { first: 'Ava' } } } };
    const I: any = { det: { row: { key: 'K1' }, detail }, keepMem: { K1: mem }, ans: {} };
    const sent: any[] = [];
    const env: Record<string, any> = {
      I, sent, detail, _ik: () => I, esc: (x: any) => String(x), _ikFieldLabel: (k: string) => k, _ikVal: (f: any, k: string) => (f && f.values && f.values[k]) || '',
      _ikAnswerSend: () => { const body = env.fns._ikAnswerBody('2026-11-24', 'K1', detail, env.fns._ikAns(), false); sent.push(body); },
      IK_FIX: ['first', 'last', 'birthday', 'mobile', 'parentName', 'parentPhone'],
    };
    env.fns = withStubs(['_ikCompareHtml', '_ikUnkeepAt', '_ikUnkeepField', '_ikUnkeep', '_ikAns', '_ikSeed', '_ikForm', '_ikStudentSub', '_ikAnswerBody'], env);
    return env;
  };
  it('a kept field with no issue carrying keep renders the kept line and the Undo button', () => {
    const e = mk(['parentPhone']);
    const h = e.fns._ikCompareHtml(e.detail, e.fns._ikAns());
    expect(h).toContain("Kept as is. The parent text goes to the parent form's mobile.");
    expect(h).toMatch(/<button[^>]*onclick="_ikUnkeepAt\(0\)">Undo keep<\/button>/);
  });
  it('a kept field that is not the parent phone says only "Kept as is."', () => {
    const e = mk(['parentName']);
    const h = e.fns._ikCompareHtml(e.detail, e.fns._ikAns());
    expect(h).toContain('Kept as is.');
    expect(h).not.toContain('The parent text goes');
    expect(h).toContain('Undo keep');
  });
  it('tapping Undo keep sends an answer whose note has keeps[sub].parentPhone === ""', () => {
    const e = mk(['parentPhone']);
    e.fns._ikUnkeepAt(0);
    expect(e.sent).toHaveLength(1);
    expect(JSON.parse(e.sent[0].note).keeps).toEqual({ S1: { parentPhone: '' } });
  });
  it('once un-kept (answer pending) the row is not shown again', () => {
    const e = mk(['parentPhone']);
    e.fns._ikUnkeepAt(0);
    expect(e.fns._ikCompareHtml(e.detail, e.fns._ikAns())).not.toContain('Undo keep');
  });
});

// ── Y2-11: one grade-filter save at a time ──
describe('Y2-11 grade filter saves are chained per leader', () => {
  const mk = () => {
    const patches: any[] = [], gates: Array<ReturnType<typeof later>> = [];
    const env: Record<string, any> = {
      patches, _vgLocal: {}, _vgBusy: {}, _vgTimer: null, _previewStash: null, getMyLeaderId: () => 'L1', _vgLeader: () => null, _vgRepaint: () => {}, toast: () => {},
      API: { patch: (p: string, b: any) => { patches.push([p, b]); const g = later(); gates.push(g); return g.p; } },
    };
    return { env, gates, fns: withStubs(['_vgSet', '_vgSave', '_vgReset'], env) };
  };
  it('a pick made during a save waits, then goes out once with the newest pick', async () => {
    vi.useFakeTimers();
    try {
      const { env, gates, fns } = mk();
      fns._vgSet([8]); await vi.advanceTimersByTimeAsync(600);
      expect(env.patches).toEqual([['/leaders/L1/view-grades', { grades: [8] }]]);
      fns._vgSet([9]); await vi.advanceTimersByTimeAsync(600);
      expect(env.patches).toHaveLength(1); // the first is still out
      fns._vgSet([9, 10]); await vi.advanceTimersByTimeAsync(600);
      expect(env.patches).toHaveLength(1);
      gates[0]!.go({}); await vi.advanceTimersByTimeAsync(0);
      expect(env.patches).toHaveLength(2);
      expect(env.patches[1]).toEqual(['/leaders/L1/view-grades', { grades: [9, 10] }]);
      gates[1]!.go({}); await vi.advanceTimersByTimeAsync(0);
      expect(env.patches).toHaveLength(2);
      expect(env._vgBusy).toEqual({});
    } finally { vi.useRealTimers(); }
  });
  it('the first save failing still lets the newest pick go out', async () => {
    vi.useFakeTimers();
    try {
      const patches: any[] = [], rejects: Array<(e: Error) => void> = [], toasts: string[] = [];
      const env: Record<string, any> = {
        _vgLocal: {}, _vgBusy: {}, _vgTimer: null, _previewStash: null, getMyLeaderId: () => 'L1', _vgLeader: () => null, _vgRepaint: () => {}, toast: (m: string) => toasts.push(m),
        API: { patch: (_p: string, b: any) => { patches.push(b); return new Promise((res, rej) => { rejects.push(rej); void res; }); } },
      };
      const fns = withStubs(['_vgSet', '_vgSave', '_vgReset'], env);
      fns._vgSet([8]); await vi.advanceTimersByTimeAsync(600);
      fns._vgSet([9]); await vi.advanceTimersByTimeAsync(600);
      rejects[0]!(new Error('offline')); await vi.advanceTimersByTimeAsync(0);
      expect(toasts).toEqual(['offline']);
      expect(patches).toEqual([{ grades: [8] }, { grades: [9] }]);
    } finally { vi.useRealTimers(); }
  });
  it('_vgReset empties the busy state', async () => {
    vi.useFakeTimers();
    try {
      const { env, fns } = mk();
      fns._vgSet([8]); await vi.advanceTimersByTimeAsync(600);
      expect(Object.keys(env._vgBusy)).toEqual(['L1']);
      fns._vgReset();
      expect(env._vgBusy).toEqual({});
    } finally { vi.useRealTimers(); }
  });
});

// ── Y2 (Y3-5, C1-3): SPA halves of two server items ──
describe('Y3-5 the dead newYouthForms fallback is gone from the SPA', () => {
  const run = (modules: Record<string, any>) => {
    const env: Record<string, any> = { S: { settings: { ministryConfig: { modules } } } };
    return withStubs(['_setupModuleMode', '_linkModeOf', '_nyModeOf'], env);
  };
  it.each([['off', 'off'], ['admin', 'admin'], ['on', 'on']])('each screen reads its own mode: %s -> %s', (mode, want) => {
    const f = run({ checkin: mode, lifegroupReport: 'off', flows: 'on', newYouthForms: 'admin' });
    expect(f._linkModeOf('checkin')).toBe(want);
    expect(f._setupModuleMode({ checkin: mode, newYouthForms: 'admin' }, 'checkin')).toBe(want);
  });
  it('a missing key is off, not newYouthForms', () => {
    const f = run({ newYouthForms: 'on' });
    expect(f._linkModeOf('flows')).toBe('off');
    expect(f._setupModuleMode({ newYouthForms: 'on' }, 'lifegroupReport')).toBe('off');
  });
});

describe('C1-3 the leader line for a refused saved-before', () => {
  it('_lkStatusText says to check in Elvanto', () => {
    const f = withStubs(['_lkStatusText'], { LK_OFFLINE_MS: 900000 });
    expect(f._lkStatusText({ status: 'refused', type: 'completeStep', reason: 'saved-before' })).toBe('Saved before but not showing in Elvanto. Check in Elvanto.');
  });
});

// ── Review R1 / low note: door rows keep long names and refusal lines; a replaced sign-out question cannot stick ──
describe('Review R1 door rows are not clipped to one ellipsized line', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  // CSS cannot run here: measure.js ('Y2-1.nameCut', 'Y2-1.refusalWrap', 'Y2-6.dncChip') measures it in a real browser. This pins the scoping.
  it('.lk-st and .lk-nm are not clipped globally (flow rows keep the Do Not Contact chip, refusals wrap)', () => {
    expect(css).not.toMatch(/\n\.lk-st\{[^}]*(nowrap|ellipsis)/);
    expect(css).not.toMatch(/\n\.lk-row \.lk-nm\{/);
  });
  it('the clipping rules are scoped to the door list (#lk-list); error lines are left to wrap', () => {
    expect(css).toMatch(/#lk-list \.lk-row \.lk-nm\{[^}]*-webkit-line-clamp:2/);
    expect(css).toMatch(/#lk-list \.lk-row \.lk-st:not\(\.bad\)\{[^}]*nowrap/);
    expect(css).toMatch(/#lk-list \.lk-row:has\(\.lk-st\) \.lk-nm\{[^}]*nowrap/);
    expect(css).toMatch(/#lk-list \.lk-row:has\(\.btn\+\.btn\) \.lk-chip\{display:none\}/);
  });
});

describe('Y2-4 a sign-out question replaced by another sheet cannot leave the sign-out stuck', () => {
  it('modal() answers a replaced _lkAsk question No; the next sign-out asks again', async () => {
    const posts: string[] = [];
    const mkEl = (): any => ({ addEventListener: () => {}, querySelector: () => mkEl(), setAttribute: () => {}, focus: () => {}, id: '', style: {} });
    const root: any = { innerHTML: '', querySelector: () => mkEl(), _ask: false };
    const env: Record<string, any> = {
      posts, root, LINK: { ask: null }, S: { user: { id: 'u1' }, page: 'home' }, _logoutBusy: false, esc: (x: any) => String(x),
      document: { getElementById: (id: string) => (id === 'modal-root' ? root : null), activeElement: null, body: {} }, _moFitViewport: () => {}, _moDismiss: () => {}, _inFlight: new Set(),
      _setupDirty: () => false, _lkQGet: () => [], _lkKey: () => 'k', _ikQLogout: async () => 0, _icLogout: async () => 0, _logoutLostText: () => '', _lkClear: () => {}, navReset: () => {},
      API: { token: 't', post: async (p: string) => { posts.push(p); }, setToken: () => {} }, render: () => {}, localStorage: { removeItem: () => {} }, sessionStorage: { removeItem: () => {} },
      _busLogoutReset: () => {}, nyReset: () => {}, _icClearLocal: () => {}, toast: () => {}, _vgReset: () => {}, _arFilter: {}, _bdayFilter: {}, _prayerFilter: {},
    };
    const f = withStubs(['doLogout', '_setupLeaveAsk', '_lkLogoutGuard', '_lkAsk', '_lkAnswer', 'modal', 'closeModal'], env);
    const p = f.doLogout(); await tick();
    expect(root.innerHTML).toContain('Sign out?');
    f.modal('<div class="mo-title">Something else</div>'); // a timer-driven prompt replaces the question
    await p;
    expect(env._logoutBusy).toBe(false);
    expect(posts).toEqual([]);
    const q = f.doLogout(); await tick();
    expect(root.innerHTML).toContain('Sign out?');
    f._lkAnswer(true); await q;
    expect(posts).toEqual(['/auth/logout']);
  });
  it('a second _lkAsk replaces the first: the first is answered No', async () => {
    const mkEl = (): any => ({ addEventListener: () => {}, querySelector: () => mkEl(), setAttribute: () => {}, focus: () => {}, id: '', style: {} });
    const root: any = { innerHTML: '', querySelector: () => mkEl(), _ask: false };
    const env: Record<string, any> = { root, LINK: { ask: null }, esc: (x: any) => String(x), document: { getElementById: (id: string) => (id === 'modal-root' ? root : null), activeElement: null }, _moFitViewport: () => {}, _moDismiss: () => {}, _inFlight: new Set() };
    const f = withStubs(['_lkAsk', '_lkAnswer', 'modal', 'closeModal'], env);
    const a = f._lkAsk('one', 'Yes', 'No', 'One?'); const b = f._lkAsk('two', 'Yes', 'No', 'Two?');
    expect(await a).toBe(false);
    f._lkAnswer(true);
    expect(await b).toBe(true);
  });
});

// ── Gate fix: the title never clips beside the pill; the Undo toast is opaque with a 44px button ──
describe('Gate: .lk-ph title, pill and toast CSS', () => {
  // A pin: the layout itself was checked in a real browser at 360 and 320 (Lifegroup report with the 2-line "Sent. Waiting for Elvanto." pill).
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  it('the title is the fixed item (no ellipsis) and the pill shrinks and wraps', () => {
    const h1 = /\.lk-ph h1\{([^}]*)\}/.exec(css)![1]!, pill = /\.lk-ph \.lk-pill\{([^}]*)\}/.exec(css)![1]!;
    expect(h1).toContain('flex:none');
    expect(h1).not.toMatch(/ellipsis|overflow/);
    expect(pill).toContain('flex:0 1 auto');
    expect(pill).toContain('min-width:0');
  });
  it('toasts have an opaque background; the Undo button is 44px', () => {
    expect(/\n\.lk-toast\{position:fixed[^}]*\}/.exec(css)![0]).toMatch(/background:#111827/);
    expect(/\n#toast\{position:fixed[^}]*\}/.exec(css)![0]).toMatch(/background:#111827/);
    expect(css).toMatch(/\.lk-toast \.btn\{[^}]*min-height:44px/);
  });
});
