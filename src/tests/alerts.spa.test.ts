// Leader alerts SPA (F5 + B3): the REAL functions from public/index.html and public/sw.js run against small stubs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const FNS = ['esc', 'getMyLeaderId', 'setMyLeaderId', '_iamNewLogin', '_noticesOn', '_ntPushSub', '_ntPushPost', '_pushLeaderSync', '_pushLoginMoved',
  'noticePushOff', '_ntAlertsCopy', '_ntPushCardHtml', '_ntPrefSet', '_navRoute', '_bdayList'];
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const flush = () => new Promise((r) => setTimeout(r, 0));

type Opts = { saved?: string | null; subscribed?: boolean; postErr?: any; role?: string; store?: Record<string, string>; students?: any[]; search?: string; notices?: string };
function env(o: Opts = {}) {
  const calls = { posts: [] as any[], unsub: 0, draw: 0, toasts: [] as string[], go: [] as string[], cleared: 0, modal: [] as string[], detail: [] as string[], gets: [] as string[] };
  const store: Record<string, string> = { ...(o.store || {}) };
  const args = { calls, store, o };
  const prelude = `
    const { calls, store, o } = ARGS;
    var S = { user: { id: 'u1', role: o.role || 'quad' }, settings: { ministryConfig: { modules: { notices: o.notices || 'on' } } } };
    let _previewStash = null, _ntPushBusy = false;
    const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    const sub = o.subscribed ? { endpoint: 'https://push.example/e1', toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => { calls.unsub++; return true; } } : null;
    const navigator = { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) } };
    const API = { post: async (p, b) => { calls.posts.push([p, b]); if (o.postErr) throw o.postErr; return 'saved' in o ? { ok: true, leaderId: o.saved } : { ok: true, leaderId: b.leaderId }; },
      get: async (p) => { calls.gets.push(p); if (p === '/students') return o.students || []; return {}; } };
    const Cache = { del: () => {} };
    const toast = (m) => calls.toasts.push(m), go = (p) => calls.go.push(p), modal = (h) => calls.modal.push(h), closeModal = () => {};
    const showStudentDetail = (id) => calls.detail.push(id);
    const history = { replaceState: () => { calls.cleared++; } };
    const location = { search: o.search || '', pathname: '/' };
    const icS = () => '';
    function _vgSnap() {} function _linkOn() { return false; } function _lkPush() {} function _ntPushDraw() { calls.draw++; }`;
  const f = new Function('ARGS', `${prelude}\n${BODY}\nreturn { ${FNS.join(', ')}, S };`)(args);
  return { ...f, calls, store };
}

describe('alerts: send the pick', () => {
  it('setMyLeaderId calls _pushLeaderSync only when subscribed', async () => {
    const off = env();
    off.setMyLeaderId(U(1)); await flush();
    expect(off.calls.posts).toHaveLength(0);
    const on = env({ subscribed: true });
    on.setMyLeaderId(U(1)); await flush();
    expect(on.calls.posts).toEqual([['/notices/push', { endpoint: 'https://push.example/e1', keys: { p256dh: 'p', auth: 'a' }, leaderId: U(1) }]]);
    expect(on.store.yap_push_leader).toBe(U(1));
  });
  it('re-posts only when the pick differs from yap_push_leader', async () => {
    const e = env({ subscribed: true, store: { yap_push_leader: U(1) } });
    e.setMyLeaderId(U(1)); await flush();
    expect(e.calls.posts).toHaveLength(0);
    e.setMyLeaderId(U(2)); await flush();
    expect(e.calls.posts).toHaveLength(1);
    expect(e.calls.posts[0][1].leaderId).toBe(U(2));
    e.setMyLeaderId(null); await flush();
    expect(e.calls.posts[1][1].leaderId).toBeNull();
    expect(e.store.yap_push_leader).toBeUndefined();
  });
  it('a failed post keeps yap_push_leader unchanged (the next change or boot retries)', async () => {
    const e = env({ subscribed: true, postErr: { status: 500 } });
    e.setMyLeaderId(U(1)); await flush();
    expect(e.store.yap_push_leader).toBeUndefined();
  });
  it('stores the leader the server saved, not the one sent (an inactive leader saves null)', async () => {
    const e = env({ subscribed: true, saved: null });
    e.setMyLeaderId(U(1)); await flush();
    expect(e.calls.posts).toHaveLength(1);
    expect(e.store.yap_push_leader).toBeUndefined(); // so the next boot or pick posts again
    const old = env({ subscribed: true, saved: undefined }); // an older server answers { ok: true }: keep what was sent
    old.setMyLeaderId(U(1)); await flush();
    expect(old.store.yap_push_leader).toBe(U(1));
  });
  it('noticePushOff clears yap_push_leader', async () => {
    const e = env({ subscribed: true, store: { yap_push_leader: U(1) } });
    await e.noticePushOff();
    expect(e.store.yap_push_leader).toBeUndefined();
    expect(e.calls.unsub).toBe(1);
  });
  it('a different login re-subscribes; a 403 unsubscribes the browser', async () => {
    const e = env({ subscribed: true, store: { yap_iam_login: 'u0', yap_leader_id: U(1), yap_push_leader: U(1) } });
    e._iamNewLogin('u1'); await flush();
    expect(e.calls.posts).toHaveLength(1);
    expect(e.calls.posts[0][1].leaderId).toBeNull();
    expect(e.calls.unsub).toBe(0);
    const same = env({ subscribed: true, store: { yap_iam_login: 'u1' } });
    same._iamNewLogin('u1'); await flush();
    expect(same.calls.posts).toHaveLength(0);
    const no = env({ subscribed: true, role: 'leader', postErr: { status: 403 }, store: { yap_iam_login: 'u0', yap_push_leader: U(1) } });
    no._iamNewLogin('u1'); await flush();
    expect(no.calls.unsub).toBe(1);
    expect(no.store.yap_push_leader).toBeUndefined();
  });
});

describe('alerts: card switches and copy', () => {
  const both = { modules: { birthdayAlerts: true, lifegroupReminders: true }, prefs: { bday: true, lgrem: false } };
  it('switch rows hidden when the module is off or alerts are off', () => {
    const e = env({ store: { yap_leader_id: U(1) } });
    expect(e._ntPushCardHtml('off', both)).not.toContain('nt-pref-');
    const on = e._ntPushCardHtml('on', both);
    expect(on).toMatch(/id="nt-pref-bday" checked/);
    expect(on).toContain('id="nt-pref-lgrem"');
    expect(on).not.toMatch(/id="nt-pref-lgrem" checked/);
    const bdayOnly = e._ntPushCardHtml('on', { modules: { birthdayAlerts: true, lifegroupReminders: false } });
    expect(bdayOnly).toContain('nt-pref-bday');
    expect(bdayOnly).not.toContain('nt-pref-lgrem');
    expect(e._ntPushCardHtml('on', { modules: {} })).not.toContain('nt-pref-');
    expect(e._ntPushCardHtml('on')).toContain('Turn off alerts'); // no config (older server) still draws
  });
  it('"Pick \'I am\'" line when no leader picked', () => {
    const e = env();
    const h = e._ntPushCardHtml('on', both);
    expect(h).toContain("Pick 'I am' to get birthday and lifegroup alerts.");
    expect(h).not.toContain('nt-pref-');
    expect(e._ntPushCardHtml('on', { modules: {} })).not.toContain('Pick');
  });
  it('a switch change posts prefs (with the pick)', async () => {
    const e = env({ subscribed: true, store: { yap_leader_id: U(1) } });
    await e._ntPrefSet('bday', false);
    expect(e.calls.posts[0][1]).toMatchObject({ endpoint: 'https://push.example/e1', leaderId: U(1), prefs: { bday: false } });
    expect(e.calls.draw).toBe(1);
  });
  it("copy: 'Get phone alerts for new notices and your students' birthdays' when only birthdayAlerts on", () => {
    const e = env();
    expect(e._ntAlertsCopy({ birthdayAlerts: true, lifegroupReminders: false })).toBe("Get phone alerts for new notices and your students' birthdays.");
    expect(e._ntAlertsCopy({})).toBe('Get phone alerts for new notices.');
    expect(e._ntAlertsCopy({ birthdayAlerts: true, lifegroupReminders: true })).toBe("Get phone alerts for new notices, your students' birthdays and lifegroup reports.");
    expect(e._ntAlertsCopy({ lifegroupReminders: true })).toBe('Get phone alerts for new notices and lifegroup reports.');
    expect(e._ntPushCardHtml('off', { modules: { birthdayAlerts: true } })).toContain("your students&#39;");
    expect(extractFn(HTML, '_quadAlertsPrompt')).toContain('_ntAlertsCopy(');
  });
});

describe('alerts: Settings parent off (I1)', () => {
  const patch = new Function(['_setupPatch', '_setupBaseOf', '_setupModuleMode', '_nyModeOf'].map((n) => extractFn(HTML, n)).join('\n') + '\nreturn _setupPatch;')();
  it('turning Notices off also saves both alert modules off', () => {
    const p = patch({ modules: { notices: 'off', birthdayAlerts: 'on', lifegroupReminders: 'on', lifegroupReport: 'on' } });
    expect(p.ministryConfig.modules).toMatchObject({ notices: 'off', birthdayAlerts: 'off', lifegroupReminders: 'off' });
  });
  it('turning Lifegroup report off saves reminders off, birthdays kept', () => {
    const p = patch({ modules: { notices: 'on', birthdayAlerts: 'on', lifegroupReminders: 'on', lifegroupReport: 'off' } });
    expect(p.ministryConfig.modules).toMatchObject({ birthdayAlerts: 'on', lifegroupReminders: 'off' });
    const inherit = patch({ modules: { notices: 'on', lifegroupReminders: 'on', newYouthForms: 'admin' } }); // follows New person
    expect(inherit.ministryConfig.modules.lifegroupReminders).toBe('on');
  });
});

describe('alerts: deep link router', () => {
  it('_navRoute rejects a bad uuid / bad date and clears the URL', () => {
    const e = env({ search: '?nav=student&ids=nope' });
    expect(e._navRoute(new URLSearchParams('nav=student&ids=nope'))).toBe(false);
    expect(e.calls.cleared).toBe(1);
    expect(e.calls.go).toEqual(['notices']);
    expect(e._navRoute({ screen: 'student', ids: [U(1)], date: '2026-13-01' })).toBe(false);
    expect(e._navRoute({ screen: 'notices', groupId: 'x' })).toBe(false);
    expect(e.calls.detail).toHaveLength(0);
  });
  it('unknown screen falls back to notices', () => {
    const e = env();
    expect(e._navRoute({ type: 'push-nav', screen: 'nowhere' })).toBe(false);
    expect(e._navRoute(new URLSearchParams('nav=notices'))).toBe(true);
    expect(e.calls.go).toEqual(['notices', 'notices']);
    expect(e.calls.cleared).toBe(0); // no ?nav= in the URL: nothing to clear
  });
});

describe('bday: student deep link (B3)', () => {
  const kids = [1, 2, 3, 4].map((n) => ({ id: U(n), firstName: `Kid${n}`, lastName: 'Test' }));
  it('one id opens showStudentDetail', async () => {
    const e = env({ students: kids });
    expect(e._navRoute({ type: 'push-nav', screen: 'student', ids: [U(1)] })).toBe(true);
    await flush();
    expect(e.calls.detail).toEqual([U(1)]);
    expect(e.calls.modal).toHaveLength(0);
  });
  it('three ids open the Birthdays today modal with three buttons', async () => {
    const e = env({ students: kids, search: `?nav=student&ids=${U(1)},${U(2)},${U(3)}` });
    expect(e._navRoute(new URLSearchParams(`nav=student&ids=${U(1)},${U(2)},${U(3)}`))).toBe(true);
    await flush();
    expect(e.calls.cleared).toBe(1);
    expect(e.calls.modal).toHaveLength(1);
    expect(e.calls.modal[0]).toContain('Birthdays today');
    expect(e.calls.modal[0].match(/<button/g)).toHaveLength(3);
    expect(e.calls.modal[0]).toContain(`showStudentDetail('${U(2)}')`);
  });
  it('ids the login cannot open are left out', async () => {
    const e = env({ students: kids.slice(0, 2) });
    e._navRoute({ screen: 'student', ids: [U(1), U(2), U(9)] }); await flush();
    expect(e.calls.modal[0].match(/<button/g)).toHaveLength(2);
    const one = env({ students: kids.slice(0, 1) });
    one._navRoute({ screen: 'student', ids: [U(1), U(9)] }); await flush();
    expect(one.calls.detail).toEqual([U(1)]);
  });
  it('none visible = toast', async () => {
    const e = env({ students: kids });
    e._navRoute({ screen: 'student', ids: [U(8), U(9)] }); await flush();
    expect(e.calls.toasts).toHaveLength(1);
    expect(e.calls.modal).toHaveLength(0);
    expect(e.calls.detail).toHaveLength(0);
  });
  it('more than 10 ids or a bad uuid is rejected by _navRoute', () => {
    const e = env({ students: kids });
    expect(e._navRoute({ screen: 'student', ids: Array.from({ length: 11 }, (_, i) => U(i + 1)) })).toBe(false);
    expect(e._navRoute({ screen: 'student', ids: [U(1), 'bad'] })).toBe(false);
    expect(e._navRoute({ screen: 'student', ids: [] })).toBe(false);
    expect(e.calls.go).toEqual(['notices', 'notices', 'notices']);
    expect(e.calls.gets).toHaveLength(0);
  });
});

describe('sw.js payloads', () => {
  function sw() {
    const src = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
    const h: Record<string, any> = {}, shown: any[] = [], posted: any[] = [], opened: string[] = [];
    let windows: any[] = [];
    const self = {
      addEventListener: (t: string, f: any) => { h[t] = f; },
      registration: { showNotification: (title: string, opts: any) => { shown.push({ title, ...opts }); return Promise.resolve(); } },
      clients: { matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } },
    };
    new Function('self', 'caches', 'fetch', src)(self, {}, () => {});
    const push = async (d: any) => { let p: any; h.push({ data: { json: () => d }, waitUntil: (x: any) => { p = x; } }); await p; return shown[shown.length - 1]; };
    const click = async (data: any, open: boolean) => {
      windows = open ? [{ focus: () => Promise.resolve(), postMessage: (m: any) => posted.push(m) }] : [];
      let p: any; h.notificationclick({ notification: { data, close: () => {} }, waitUntil: (x: any) => { p = x; } }); await p;
    };
    return { push, click, posted, opened };
  }
  it('old payload with no tag/screen shows tag notice, opens notices', async () => {
    const s = sw();
    const n = await s.push({ title: 'New notice', body: 'Hi' });
    expect(n.tag).toBe('notice');
    expect(n.data).toEqual({ screen: 'notices' });
    await s.click(n.data, true);
    expect(s.posted).toEqual([{ type: 'push-nav', screen: 'notices' }]);
    await s.click(n.data, false);
    expect(s.opened).toEqual(['/?nav=notices']);
  });
  it('bday payload keeps tag bday and posts screen student with ids', async () => {
    const s = sw();
    const n = await s.push({ title: 'Birthday', body: 'x', tag: 'bday', screen: 'student', ids: [U(1), U(2)] });
    expect(n.title).toBe('Birthday');
    expect(n.tag).toBe('bday');
    expect(n.data).toEqual({ screen: 'student', ids: [U(1), U(2)] });
    await s.click(n.data, true);
    expect(s.posted).toEqual([{ type: 'push-nav', screen: 'student', ids: [U(1), U(2)] }]);
    await s.click(n.data, false);
    expect(s.opened).toEqual([`/?nav=student&ids=${encodeURIComponent(`${U(1)},${U(2)}`)}`]);
  });
});
