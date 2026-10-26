// Rev 20 (2026-10-25): the door's "Slow: Search Elvanto" button, its wait, and its three endings (found, not found, unavailable).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

const NAMES = ['esc', '_lkEsOn', '_lkEsCur', '_lkEsHtml', '_lkEsPaint', '_lkEsCancel', '_lkEsEnd', '_lkEsGo', '_lkEsPoll', '_lkRowHtml', '_structure', '_gradeWord'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Env = Record<string, any>;
let E: Env;
let F: Env;
const PRELUDE = `const E = globalThis.__es;
const LK_ES_WAIT_MS = 60000, LK_ES_POLL_MS = 2500;
var S = E.S, LINK = E.LINK;
const _lkCap = (t) => E.caps[t] || null, _lkCapOff = (t) => E.caps[t] === 'off';
const _lkLists = () => ({ due: E.due, done: [] }), _lkSvc = () => ({ serviceTimeId: 'svc' }), _nyOn = () => E.ny;
const icS = () => '', _lkUuid = () => 'id-' + (++E.n), _deviceId = () => 'dev', _deviceLabel = () => 'phone';
const document = { getElementById: (id) => E.els[id] || null };
const _lkRefreshView = () => { E.els['lk-es'].innerHTML = _lkEsHtml(); };
const _lkLoadPeople = async () => { E.loads++; return true; };
const API = { post: (p, b, t, q) => E.post(p, b), fresh: (p) => E.fresh(p) };
const navigator = { userAgent: 'x' };
const _lkStatusTone = () => '', _lkStatusHtml = () => '', _lkLastSeen = () => null, _lkSvcDay = () => '2026-10-30';`;

beforeEach(() => {
  vi.useFakeTimers();
  E = { S: { page: 'link-checkin' }, LINK: { q: { search: 'Sam' }, svc: 'svc', es: null, refusals: {}, services: [] },
    caps: { checkIn: 'live', doorSearch: 'live' }, due: [], ny: true, n: 0, loads: 0, els: { 'lk-es': { innerHTML: '' } },
    posts: [] as Env[], polls: [] as string[], answer: (_id: string): Env | null => ({ status: 'pending' }),
    post: async (_p: string, b: Env) => { E.posts.push(b); return { results: [{ kind: 'action', id: b.items[0].id, outcome: 'saved' }] }; },
    fresh: async (p: string) => { E.polls.push(p); const id = decodeURIComponent(p.split('ids=')[1]!); const a = E.answer(id); return a ? [{ id, ...a }] : []; } };
  (globalThis as Env).__es = E;
  F = loadFns(NAMES, PRELUDE);
});
afterEach(() => { vi.useRealTimers(); delete (globalThis as Env).__es; });
const html = () => F._lkEsHtml() as string;
const tick = (ms = 2500) => vi.advanceTimersByTimeAsync(ms);

describe('rev 20 door: Slow: Search Elvanto', () => {
  it('shows for any check-in login once 2+ letters are typed and the console lists doorSearch live; never admin-gated', async () => {
    expect(html()).toContain('Slow: Search Elvanto');
    E.LINK.q.search = 'S'; expect(html()).toBe('');
    E.LINK.q.search = 'Sa';
    E.caps.doorSearch = undefined; expect(html()).toBe(''); // an older console never lists it
    E.caps.doorSearch = 'off'; expect(html()).toBe('');
    E.caps.doorSearch = 'live'; E.caps.checkIn = 'off'; expect(html()).toBe('');
    const src = ['_lkEsOn', '_lkEsHtml', '_lkEsGo'].map((n) => loadIndexHtml().match(new RegExp(`function ${n}\\([\\s\\S]*?\\n}`))![0]).join('');
    expect(src).not.toMatch(/.role|isAdmin|_linkAdminOn|_ikModuleOn/);
    // the button sits just above New person on the door
    const door = loadIndexHtml().match(/function _lkPaintDoor\(\)[\s\S]*?\n}/)![0];
    expect(door.indexOf('<div id="lk-es">')).toBeGreaterThan(door.indexOf('<div id="lk-list">'));
    expect(door.indexOf('<div id="lk-es">')).toBeLessThan(door.indexOf('New person (first time here)'));
  });
  it('a tap sends the typed name in the note (payload {ref} only) and shows the 30 second wait with Cancel', async () => {
    E.LINK.q.search = '  Sam Sample ';
    await F._lkEsGo();
    const it0 = E.posts[0].items[0];
    expect(it0).toEqual({ kind: 'action', id: 'id-1', type: 'doorSearch', payload: { ref: 'id-1' }, note: 'Sam Sample', leaderId: null });
    expect(E.els['lk-es'].innerHTML).toContain('Searching Elvanto… this can take up to 30 seconds');
    expect(E.els['lk-es'].innerHTML).toContain('Cancel');
  });
  it('hit: the list reloads and the hits are told apart by grade and gender, with the normal Check in (never automatic)', async () => {
    E.answer = () => ({ status: 'sent' });
    await F._lkEsGo(); await tick();
    expect(E.loads).toBe(1);
    expect(E.posts).toHaveLength(1); // no check-in was sent for the leader
    E.due = [{ personId: 'p1', name: 'Sam Sample', grade: 9, gender: 'female', checkedIn: false }];
    expect(html()).toContain('Found in Elvanto');
    const row = F._lkRowHtml(E.due[0]);
    expect(row).toContain('Grade 9 · Girl');
    expect(row).toContain("_lkCheck('p1','checkIn')");
    E.LINK.es = null;
    expect(F._lkRowHtml(E.due[0])).not.toContain('Girl'); // a plain door row is unchanged
  });
  it('no hit: "Not found in Elvanto", with Add as a new person when the list does not already show it', async () => {
    E.answer = () => ({ status: 'refused', reason: 'person-unknown' });
    await F._lkEsGo(); await tick();
    expect(html()).toContain('Not found in Elvanto');
    expect(html()).not.toContain('as a new person'); // the empty list shows its own Add button
    E.due = [{ personId: 'p9', name: 'Sam Other', grade: 8, checkedIn: false }];
    expect(html()).toContain('Sam&#39; as a new person');
  });
  it('console offline: no answer within a minute -> "isn\'t available right now" (with the new person button); polls stop', async () => {
    E.due = [{ personId: 'p9', name: 'Sam Other', grade: 8, checkedIn: false }];
    await F._lkEsGo();
    await tick(59000);
    expect(html()).toContain('Searching Elvanto');
    await tick(2500);
    expect(html()).toContain("Elvanto search isn't available right now");
    expect(html()).toContain('Sam&#39; as a new person');
    const n = E.polls.length; await tick(10000);
    expect(E.polls.length).toBe(n);
  });
  it('a refused queue (older console, 409) or another refusal reads as unavailable at once', async () => {
    E.post = async (_p: string, b: Env) => ({ results: [{ kind: 'action', id: b.items[0].id, outcome: 'refused', code: 'LINK_UNAVAILABLE' }] });
    await F._lkEsGo();
    expect(html()).toContain("isn't available right now");
    expect(E.polls).toHaveLength(0);
  });
  it('one search per login: a new one replaces the old (its poll stops); Cancel stops polling and brings the button back', async () => {
    await F._lkEsGo();
    E.LINK.q.search = 'Samuel';
    await F._lkEsGo();
    await tick(); await tick();
    expect(new Set(E.polls.map((p: string) => p.split('ids=')[1]))).toEqual(new Set(['id-2']));
    F._lkEsCancel();
    expect(E.LINK.es).toBeNull();
    expect(E.els['lk-es'].innerHTML).toContain('Slow: Search Elvanto');
    const n = E.polls.length; await tick(10000);
    expect(E.polls.length).toBe(n);
  });
  it('the result belongs to the typed name: editing the name shows the button again', async () => {
    E.answer = () => ({ status: 'refused', reason: 'person-unknown' });
    await F._lkEsGo(); await tick();
    E.LINK.q.search = 'Sammy';
    expect(html()).toContain('Slow: Search Elvanto');
  });
});
