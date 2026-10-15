// Fix round 16 Oct 2026, lane D (Link core + door + New person): run from the REAL page source.
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

describe('F-02(a) door: a double tap checks in one person and keeps the row in place', () => {
  const prelude = `
    let LINK = { svc: 'S', people: { S: { people: [
      { personId: 'tom', name: 'Tom LEstrange', checkedIn: false },
      { personId: 'ree', name: 'Ree LEstrange', checkedIn: false }] } }, q: { search: 'lestrange' }, refusals: {} };
    let Q = [];
    const pushed = [];
    function _lkSvc() { return { serviceTimeId: 'S', serviceId: 'SV' }; }
    function _lkQGet() { return Q.slice(); }
    function _lkQSet(q) { Q = q.slice(); }
    function _lkQueuedIdx(q, svc, pid) { return q.findIndex((it) => it.payload && it.payload.personId === pid); }
    function _lkTakeBack() { return false; }
    function _lkRefreshView() {}
    function _lkPush(it) { pushed.push(it); Q.push(it); }
    function _lkTapToast() {}
    function getMyLeaderId() { return null; }
    function _lkUuid() { return 'id' + pushed.length; }
    function _lkMerge(people, q) { return people.map((p) => q.some((it) => it.payload.personId === p.personId) ? Object.assign({}, p, { checkedIn: true, queued: true }) : p); }
    function _lkFilter(l) { return l; }
    function setT(ms) { LINK.doorAt = Date.now() - ms; }
    function state() { return { pushed, Q }; }`;
  const f = loadFns(['_lkCheck', '_lkLists'], prelude, ['_lkCheck', '_lkLists', 'setT', 'state']);

  it('a second tap on the same row within 600 ms is a no-op (no undo)', () => {
    f._lkCheck('tom', 'checkIn');
    f._lkCheck('tom', 'checkIn'); // would take the queued item back
    expect(f.state().pushed.length).toBe(1);
    expect(f.state().Q.map((x: any) => x.payload.personId)).toEqual(['tom']);
  });
  it('the tapped row stays in the match list for 600 ms, then moves to Checked in', () => {
    expect(f._lkLists().due.map((p: any) => p.personId)).toEqual(['tom', 'ree']);
    f.setT(700);
    const l = f._lkLists();
    expect(l.due.map((p: any) => p.personId)).toEqual(['ree']);
    expect(l.done.map((p: any) => p.personId)).toEqual(['tom']);
  });
  it('another person can be tapped straight away', () => {
    f._lkCheck('ree', 'checkIn');
    expect(f.state().pushed.length).toBe(2);
  });
});

describe('F-06 / F-34 nySend', () => {
  const prelude = `
    const full = { host: '', firstName: 'Tom', lastName: 'L', dob: '2010-01-01', gender: 'm', grade: 9, school: 'S', mobile: '0412345678',
      parentFirst: 'Ree', parentLast: 'L', parentMobile: '0412345679' };
    let NY = { sending: false }; let LINK = { ldrs: null }; const S = { page: 'new-youth', user: { id: 'u' } };
    const navigator = { onLine: true };
    const posts = [], toasts = [];
    let release;
    function _nyRead() { return Object.assign({}, full); }
    function getMyLeaderId() { return 'L1'; }
    function _lkLoadLeaders() { return new Promise((r) => { release = () => { LINK.ldrs = []; r(); }; }); }
    function _nyHost() { return 'Host'; }
    function _nyPickHost() {}
    function _nyDobProblem() { return ''; }
    function _nyToday() { return '2026-10-16'; }
    function _nyFieldMsgs() { return { block: {} }; }
    function _nyShowMsgs() {}
    function toast(t) { toasts.push(t); }
    const document = { getElementById() { return null; }, querySelector() { return null; } };
    const API = { post(u, b) { posts.push(b); return Promise.resolve({}); } };
    function renderNewYouth() {}
    function _nyMessage() { return { lines: [] }; }
    function _nyErrorText(e) { return { text: String(e), unsent: true }; }
    function rel() { release(); }
    function st() { return { posts, toasts }; }
    function offline() { navigator.onLine = false; full.host = 'Host'; }`;
  it('F-06: two taps while the leaders load give one POST', async () => {
    const f = loadFns(['nySend'], prelude, ['nySend', 'rel', 'st']);
    const a = f.nySend();
    const b = f.nySend();
    await Promise.resolve();
    f.rel();
    await a; await b;
    expect(f.st().posts.length).toBe(1);
  });
  it('F-34: offline stays on the form and sends nothing', async () => {
    const f = loadFns(['nySend'], prelude, ['nySend', 'st', 'offline']);
    f.offline();
    await f.nySend();
    expect(f.st().posts.length).toBe(0);
    expect(f.st().toasts).toEqual(["You're offline. Nothing was sent."]);
  });
});

describe('F-11 / F-12 / F-51 the no-link line', () => {
  const prelude = `
    const LK_OFFLINE_MS = 15 * 60000;
    let S = { user: { role: 'admin' } };
    let LINK = { status: null };
    function _lkSeen() { return '5:15 am'; }
    function icS() { return ''; }
    function esc(s) { return String(s); }
    function role(r) { S.user.role = r; }
    function setSt(st) { LINK.status = st; }`;
  const f = loadFns(['_lkBoss', '_lkOfflineSince', '_lkBanner', '_lkOfflineHtml'], prelude, ['_lkBanner', '_lkOfflineHtml', 'role', 'setSt']);
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  const st = (c: any) => ({ console: { lastSeenAt: old, capabilities: {}, consoles: 1, ...c } });
  const text = (h: string) => h.replace(/<[^>]+>/g, '');
  it('F-11: online with a 20-minute-old lastSeenAt shows no line (admin, Home and Check-in)', () => {
    f.role('admin');
    expect(f._lkBanner(['checkIn'], st({ online: true }))).toBe('');
    f.setSt(st({ online: true }));
    expect(f._lkOfflineHtml()).toBe('');
  });
  it('F-12: one plain line; the kiosk line only on Check-in', () => {
    f.role('admin');
    expect(text(f._lkBanner(['checkIn', 'checkOut'], st({ online: false })))).toBe('No link to Elvanto since 5:15 am. Your taps send later. Use the kiosk too.');
    expect(text(f._lkBanner(['submitReport'], st({ online: false })))).toBe('No link to Elvanto since 5:15 am. Your taps send later.');
    expect(text(f._lkBanner(['checkIn'], { console: null }))).toBe('No link to Elvanto yet. Your taps send later. Use the kiosk too.');
  });
  it('F-12: leaders get the pill only, except on the door', () => {
    f.role('leader');
    expect(f._lkBanner(['submitReport'], st({ online: false }))).toBe('');
    expect(text(f._lkBanner(['checkIn'], st({ online: false })))).toContain('Use the kiosk too.');
  });
  it('F-51: the Home offline line is role=status, not alert', () => {
    f.role('admin');
    f.setSt(st({ online: false }));
    const h = f._lkOfflineHtml();
    expect(h).toContain('role="status"');
    expect(text(h)).toBe('No link to Elvanto since 5:15 am. Your taps send later.');
  });
});
