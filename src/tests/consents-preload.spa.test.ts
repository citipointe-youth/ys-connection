// ux-run-2026-10-18 (P1/P2/P4): New youth & consent preloads every Tidy up list; kept answers (ids only, never names) show at once
// after a reload; a console at rev >= 11 is asked for what is NEW since the kept check first, then everything again.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['_ikLk', '_ikLkBusy', '_ikLkGate', '_ikRev', '_ikClCap', '_ikLkItem', '_ikLkApply', '_ikLkReason',
  '_ikLkPreload', '_ikLkWarm', '_ikLkRestore', '_ikLkKeepKey', '_ikLkKept', '_ikLkKeep', '_ikLkMerge', '_ikLkDone'];
const HTML = loadIndexHtml();
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const CONSTS = ['IK_LK_FRESH_MS', 'IK_LK_KINDS', 'IK_LK_SINCE_REV', 'IK_LK_LOCK_MS', 'IK_LK_TAB'].map((n) => HTML.match(new RegExp(`^const ${n} = [^;]*;`, "m"))![0]).join('\n');
const NOW = Date.parse('2026-10-18T05:30:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function env(I: any = {}, o: { store?: Record<string, string>; fresh?: (p: string) => any; noStorage?: boolean } = {}) {
  const asked: Array<{ k: string; p: number; q: string; after: string | null }> = [];
  const gets: string[] = [];
  const store = o.store ?? {};
  const st = { tab: 'consent', lk: {}, lkPre: 0, ...I };
  const ls = o.noStorage ? null : { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = String(v); } };
  const fns = new Function('__I', '__asked', '__gets', '__fresh', '__ls', `
    const S = { page: 'link-intake', user: { id: 'u-admin' } };
    const localStorage = __ls || { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const _ik = () => __I;
    const _ikDraw = () => {};
    const _ikSt = () => null;
    const API = { fresh: async (p) => { __gets.push(p); return __fresh(p); } };
    const _ikLkGo = (k, p, q, sameId, after) => { __asked.push({ k, p, q, after: after || null }); const x = __I.lk[k];
      x.st = 'asking'; x.after = after || null; if (!after) x.full = false; };
    ${CONSTS}
    ${BODY}
    return { ${FNS.join(', ')} };`)(st, asked, gets, o.fresh ?? (() => ({ status: 'failed', reason: 'expired' })), ls);
  return { fns, I: st, asked, gets, store };
}
const ST = (o: any = {}, caps: Record<string, string> = {}, rev = 10) => ({ consoleLinkRev: rev,
  console: { online: true, inWindow: false, capabilities: { consentLookup: 'live', consentLink: 'live', ...caps }, ...o } });
const kinds = (a: Array<{ k: string }>) => a.map((x) => x.k);

describe('P1/P2 preload: every Tidy up list on entry', () => {
  it('asks for all four lists (Profiles that differ included), page 1, no search', () => {
    const { fns, asked } = env();
    expect(fns._ikLkPreload(ST(), NOW)).toEqual(['unlinked', 'mismatches', 'forms', 'other']);
    expect(asked.every((a) => a.p === 1 && a.q === '' && a.after === null)).toBe(true);
  });
  it('only on the Consents tab', () => {
    expect(env({ tab: 'intake' }).fns._ikLkPreload(ST(), NOW)).toEqual([]);
  });
  it('skips in the service window, with the console offline, or with lookups off', () => {
    expect(env().fns._ikLkPreload(ST({ inWindow: true }), NOW)).toEqual([]);
    expect(env().fns._ikLkPreload(ST({ online: false }), NOW)).toEqual([]);
    expect(env().fns._ikLkPreload(ST({}, { consentLookup: 'off' }), NOW)).toEqual([]);
    expect(env().fns._ikLkPreload(null, NOW)).toEqual([]);
  });
  it('skips unlinked without consentLink and other below console rev 8', () => {
    expect(env().fns._ikLkPreload(ST({}, { consentLink: 'off' }, 7), NOW)).toEqual(['mismatches', 'forms']);
  });
  it('keeps a search, a later page, a busy or failed ask and a fresh answer; asks again for a stale one', () => {
    const lk = {
      unlinked: { kind: 'unlinked', q: 'smith', st: 'idle', res: null },
      mismatches: { kind: 'mismatches', q: '', st: 'ready', res: { page: 1, takenAt: iso(2 * 60e3) }, resQ: '' },
      forms: { kind: 'forms', q: '', st: 'ready', res: { page: 2, takenAt: iso(20 * 60e3) }, resQ: '' },
      other: { kind: 'other', q: '', st: 'ready', res: { page: 1, takenAt: iso(20 * 60e3) }, resQ: '' },
    };
    expect(env({ lk }).fns._ikLkPreload(ST(), NOW)).toEqual(['other']);
    expect(env({ lk: { mismatches: { kind: 'mismatches', q: '', st: 'working', res: null } } }).fns._ikLkPreload(ST(), NOW)).not.toContain('mismatches');
    expect(env({ lk: { other: { kind: 'other', q: '', st: 'failed', res: null } } }).fns._ikLkPreload(ST(), NOW)).not.toContain('other');
  });
});

describe('_ikLkWarm: once per page entry', () => {
  it('restores, then preloads; a second call within a minute does nothing', async () => {
    const { fns, asked } = env();
    expect(await fns._ikLkWarm(ST(), NOW)).toEqual(['unlinked', 'mismatches', 'forms', 'other']);
    expect(await fns._ikLkWarm(ST(), NOW + 5000)).toEqual([]);
    expect(asked.length).toBe(4);
  });
  it('not on the New youth tab', async () => {
    const { fns, asked } = env({ tab: 'intake' });
    expect(await fns._ikLkWarm(ST(), NOW)).toEqual([]);
    expect(asked.length).toBe(0);
  });
});

describe('P4 kept answers: ids only, shown at once after a reload', () => {
  it('a full page-1 answer with no search keeps its id and time; a search or a later page never does', () => {
    const { fns, I, store } = env();
    const x = fns._ikLk('mismatches');
    Object.assign(x, { id: ID(1), st: 'ready', page: 1, q: '', resQ: '', after: null, res: { page: 1, takenAt: iso(0), rows: [{ subId: ID(9), name: 'A Child' }] } });
    fns._ikLkDone('mismatches');
    const kept = JSON.parse(store['ysc.ikLk.u-admin']!);
    expect(kept.mismatches).toEqual({ id: ID(1), at: iso(0) });
    expect(JSON.stringify(kept)).not.toContain('A Child'); // never a name on the phone
    Object.assign(I.lk.mismatches, { id: ID(2), resQ: 'smith' });
    fns._ikLkDone('mismatches');
    Object.assign(I.lk.mismatches, { id: ID(3), resQ: '', page: 2, res: { page: 2, takenAt: iso(0), rows: [] } });
    fns._ikLkDone('mismatches');
    expect(JSON.parse(store['ysc.ikLk.u-admin']!).mismatches.id).toBe(ID(1));
  });
  it('restore reads each kept answer back and shows it ready with its checked time', async () => {
    const store = { 'ysc.ikLk.u-admin': JSON.stringify({ forms: { id: ID(4), at: iso(30 * 60e3) } }) };
    const ans = { status: 'ready', id: ID(4), kind: 'forms', page: 1, pageSize: 25, total: 1, takenAt: iso(30 * 60e3), rows: [{ subId: ID(5) }] };
    const { fns, I, gets } = env({}, { store, fresh: () => ans });
    await fns._ikLkRestore(ST(), NOW);
    expect(gets).toEqual([`/link/consents/lookup?id=${ID(4)}`]);
    expect(I.lk.forms.st).toBe('ready');
    expect(I.lk.forms.res.takenAt).toBe(ans.takenAt);
    expect(I.lk.forms.id).toBe(ID(4));
  });
  it('an expired, failed or unreachable kept answer is dropped quietly (no error on the screen)', async () => {
    const store = { 'ysc.ikLk.u-admin': JSON.stringify({ forms: { id: ID(4), at: iso(60e3) }, other: { id: ID(6), at: iso(60e3) } }) };
    const { fns, I } = env({}, { store, fresh: (p: string) => { if (p.includes(ID(6))) throw Object.assign(new Error('x'), { status: 404 }); return { status: 'failed', reason: 'expired' }; } });
    await fns._ikLkRestore(ST(), NOW);
    expect(I.lk.forms.st).toBe('idle');
    expect(I.lk.forms.msg).toBeFalsy();
    expect(I.lk.other.st).toBe('idle');
    expect(JSON.parse(store['ysc.ikLk.u-admin']!)).toEqual({});
  });
  it('a kept answer over a day old is not even asked for', async () => {
    const store = { 'ysc.ikLk.u-admin': JSON.stringify({ forms: { id: ID(4), at: iso(25 * 3600e3) } }) };
    const { fns, gets } = env({}, { store });
    await fns._ikLkRestore(ST(), NOW);
    expect(gets).toEqual([]);
  });
  it('blocked storage never breaks the page', async () => {
    const { fns } = env({}, { noStorage: true });
    expect(fns._ikLkKept()).toEqual({});
    expect(() => fns._ikLkKeep('forms', ID(1), iso(0))).not.toThrow();
    await expect(fns._ikLkRestore(ST(), NOW)).resolves.toBeUndefined();
  });
  it('garbage in storage reads as nothing kept', () => {
    expect(env({}, { store: { 'ysc.ikLk.u-admin': '{not json' } }).fns._ikLkKept()).toEqual({});
    expect(env({}, { store: { 'ysc.ikLk.u-admin': '[1,2]' } }).fns._ikLkKept()).toEqual({});
  });
});

describe('P4 two passes: new since the kept check, then everything', () => {
  const kept = (kind: string) => ({ kind, q: '', st: 'ready', resQ: '', page: 1, res: { page: 1, pageSize: 25, total: 2, takenAt: iso(20 * 60e3),
    rows: kind === 'other' ? [{ personId: ID(21) }, { personId: ID(22) }] : [{ subId: ID(11) }, { subId: ID(12) }] } });
  it('a rev 11 console with a kept answer gets pass 1 "after" the kept time, flagged for a full pass after', () => {
    const { fns, I, asked } = env({ lk: { forms: kept('forms') } });
    fns._ikLkPreload(ST({}, {}, 11), NOW);
    expect(asked.find((a) => a.k === 'forms')).toEqual({ k: 'forms', p: 1, q: '', after: iso(20 * 60e3) });
    expect(I.lk.forms.full).toBe(true);
    expect(asked.find((a) => a.k === 'mismatches')!.after).toBeNull(); // nothing kept: one full pass
  });
  it('a console below rev 11 gets a full pass only (graceful)', () => {
    const { fns, asked } = env({ lk: { forms: kept('forms') } });
    fns._ikLkPreload(ST(), NOW);
    expect(asked.find((a) => a.k === 'forms')!.after).toBeNull();
  });
  it('the outbox item carries since only for pass 1', () => {
    const { fns } = env();
    expect(fns._ikLkItem('forms', 1, '', ID(1)).payload).toEqual({ kind: 'forms', page: 1, ref: ID(1) });
    expect(fns._ikLkItem('forms', 1, '', ID(1), iso(60e3)).payload).toEqual({ kind: 'forms', page: 1, ref: ID(1), since: iso(60e3) });
  });
  it('pass 1 puts new rows on top of the kept ones (no duplicates), keeps the kept checked time, then runs pass 2', () => {
    const { fns, I, asked } = env({ lk: { forms: { ...kept('forms'), st: 'working', after: iso(20 * 60e3), full: true } } });
    const x = I.lk.forms;
    fns._ikLkApply(x, { status: 'ready', page: 1, pageSize: 25, total: 2, takenAt: iso(0), rows: [{ subId: ID(13) }, { subId: ID(11), changed: 1 }] }, NOW);
    expect(x.res.rows.map((r: any) => r.subId)).toEqual([ID(13), ID(11), ID(12)]);
    expect(x.res.rows[1].changed).toBe(1);
    expect(x.res.total).toBe(3);
    expect(x.res.takenAt).toBe(iso(20 * 60e3)); // older rows are not re-checked yet
    fns._ikLkDone('forms');
    expect(asked).toEqual([{ k: 'forms', p: 1, q: '', after: null }]);
  });
  it('Other merges by person', () => {
    const { fns } = env();
    const m = fns._ikLkMerge(kept('other').res, { rows: [{ personId: ID(23) }, { personId: ID(21) }] }, 'other');
    expect(m.rows.map((r: any) => r.personId)).toEqual([ID(23), ID(21), ID(22)]);
  });
  it('a pass 1 the console refuses falls back to a full pass, quietly', () => {
    const { fns, I, asked } = env({ lk: { forms: { ...kept('forms'), st: 'working', after: iso(20 * 60e3), full: true } } });
    fns._ikLkApply(I.lk.forms, { status: 'failed', reason: 'unknown' }, NOW);
    fns._ikLkDone('forms');
    expect(asked).toEqual([{ k: 'forms', p: 1, q: '', after: null }]);
    expect(I.lk.forms.res.rows.length).toBe(2); // the kept rows stay on screen
  });
  it('pass 1 is never kept as the answer (only a full pass is)', () => {
    const { fns, I, store } = env({ lk: { forms: { ...kept('forms'), id: ID(30), st: 'ready', after: iso(20 * 60e3), full: true } } });
    fns._ikLkDone('forms');
    expect(store['ysc.ikLk.u-admin']).toBeUndefined();
    expect(I.lk.forms.after).toBeNull();
  });
});

describe('P4 contract: consentLookup payload may carry since (optional, for a console at rev >= 11)', () => {
  it('accepts an ISO since and still accepts none; rejects a non-date', async () => {
    const C = await import('../core/link-contract');
    const ref = ID(1);
    expect(() => C.PAYLOAD_SCHEMAS.consentLookup.parse({ kind: 'forms', page: 1, ref })).not.toThrow();
    expect(() => C.PAYLOAD_SCHEMAS.consentLookup.parse({ kind: 'forms', page: 1, ref, since: '2026-10-18T05:30:00.000Z' })).not.toThrow();
    expect(() => C.PAYLOAD_SCHEMAS.consentLookup.parse({ kind: 'forms', page: 1, ref, since: 'yesterday' })).toThrow();
  });
});

// N06: two tabs of the same login must not both ask (the server supersedes a login's older pending lookup of the same kind),
// and a hidden tab must not keep polling.
describe('N06 one tab warms per login', () => {
  it('a second tab within 3 min asks nothing; after 3 min it asks again', () => {
    const store: Record<string, string> = {};
    expect(env({}, { store }).fns._ikLkPreload(ST(), NOW)).toHaveLength(4);
    expect(env({}, { store }).fns._ikLkPreload(ST(), NOW + 60e3)).toEqual([]);
    expect(env({}, { store }).fns._ikLkPreload(ST(), NOW + 3 * 60e3 + 1)).toHaveLength(4);
  });
  it('the same tab is not blocked by its own lock', () => {
    const store: Record<string, string> = {};
    const a = env({}, { store });
    a.fns._ikLkPreload(ST(), NOW);
    a.I.lk = {};
    expect(a.fns._ikLkPreload(ST(), NOW + 60e3)).toHaveLength(4);
  });
  it('blocked storage still preloads', () => {
    expect(env({}, { noStorage: true }).fns._ikLkPreload(ST(), NOW)).toHaveLength(4);
  });
});

describe('N06 no lookup polls from a hidden tab', () => {
  const poller = () => {
    const t = { cbs: [] as Array<() => any>, gets: [] as string[], ls: [] as Array<() => void>, vis: 'visible' };
    const I: any = { lk: { forms: { kind: 'forms', id: ID(9), st: 'waiting', since: NOW, q: '', page: 1 } } };
    const fns = new Function('__I', '__t', `
      const S = { page: 'link-intake' };
      const document = { get visibilityState() { return __t.vis; }, addEventListener: (n, f) => __t.ls.push(f),
        removeEventListener: (n, f) => { __t.ls = __t.ls.filter((g) => g !== f); } };
      const setTimeout = (cb) => { __t.cbs.push(cb); return __t.cbs.length; };
      const clearTimeout = () => {};
      const _ik = () => __I; const _ikDraw = () => {};
      const API = { fresh: async (p) => { __t.gets.push(p); return { status: 'waiting' }; } };
      ${['_ikLk', '_ikLkApply', '_ikLkReason', '_ikLkErr', '_ikLkDone', '_ikLkKeep', '_ikLkPoll'].map((n) => extractFn(HTML, n)).join('\n')}
      return { _ikLkPoll };`)(I, t);
    return { fns, t, I };
  };
  it('a timer firing while hidden does not ask, re-arms the timer (R19-S5: no listener), and asks once visible', async () => {
    const { fns, t, I } = poller();
    fns._ikLkPoll('forms');
    t.vis = 'hidden';
    for (let i = 0; i < 3; i++) {
      await t.cbs.shift()!();
      expect(t.gets).toEqual([]);
      expect(t.cbs).toHaveLength(1); // one timer re-armed
      expect(t.ls).toHaveLength(0); // never a visibilitychange listener
    }
    expect(I.lk.forms.poll).toBeTruthy();
    t.vis = 'visible';
    await t.cbs.shift()!();
    expect(t.gets).toHaveLength(1);
  });
});
