// C0: shared still-here guard (_here/_still/_stillSheet) + API keepalive pass-through.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

describe('C0 still-here guard', () => {
  function setup() {
    const env: any = { mo: null };
    const prelude = `
      var S = { page: 'link-intake' };
      var NAV = { stack: [{}] };
      var LINK = { gid: null, rf: null, ik: { key: 'fam1', tab: 'intake', date: '2026-10-16', csub: null } };
      var document = { querySelector: (q) => (q === '#modal-root .mo' ? env.mo : null) };`;
    const f = new Function('env', `${prelude}\n${['_navSnap', '_navSame', '_here', '_still', '_stillSheet']
      .map((n) => extractFn(loadIndexHtml(), n)).join('\n')}
      return { _here, _still, _stillSheet, S, NAV, LINK };`)(env);
    return { ...f, env };
  }

  it('same page, key and stack -> still', () => {
    const t = setup();
    const h = t._here();
    expect(t._still(h)).toBe(true);
  });
  it('family key changed -> not still', () => {
    const t = setup(); const h = t._here();
    t.LINK.ik.key = 'fam2';
    expect(t._still(h)).toBe(false);
  });
  it('page changed -> not still', () => {
    const t = setup(); const h = t._here();
    t.S.page = 'home';
    expect(t._still(h)).toBe(false);
  });
  it('stack length changed -> not still', () => {
    const t = setup(); const h = t._here();
    t.NAV.stack.push({});
    expect(t._still(h)).toBe(false);
  });
  it('null handle -> false', () => {
    const t = setup();
    expect(t._still(null)).toBe(false);
    expect(t._stillSheet(null)).toBe(false);
  });
  it('_stillSheet: same sheet true, swapped or closed false', () => {
    const t = setup();
    const a = {}; t.env.mo = a;
    const h = t._here();
    expect(t._stillSheet(h)).toBe(true);
    t.env.mo = {};
    expect(t._stillSheet(h)).toBe(false);
    t.env.mo = null;
    expect(t._stillSheet(h)).toBe(false);
    expect(t._stillSheet(setup()._here())).toBe(false); // no sheet when captured
  });
});

describe('C0 API keepalive pass-through', () => {
  function api() {
    const src = loadIndexHtml();
    const start = src.indexOf('const API = (() => {');
    const end = src.indexOf('\n})();', start);
    expect(start).toBeGreaterThan(0);
    const calls: any[] = [];
    const fetch = async (path: string, opts: any) => { calls.push({ path, opts }); return { ok: true, json: async () => ({ ok: 1 }) }; };
    const API = new Function('fetch', `
      const _lsGet = () => null, _npStart = () => {}, _npDone = () => {}, Cache = { get: () => null, set: () => {} }, SECTION_OF = {};
      ${src.slice(start, end + 6)}
      return API;`)(fetch);
    return { API, calls };
  }

  it('post with keepalive=true sends keepalive:true', async () => {
    const { API, calls } = api();
    await API.post('/x', { a: 1 }, 25000, true, true);
    expect(calls[0].opts.keepalive).toBe(true);
  });
  it('existing callers (no keepalive arg) send keepalive:false', async () => {
    const { API, calls } = api();
    await API.post('/x', { a: 1 });
    await API.get('/y');
    expect(calls.map((c) => c.opts.keepalive)).toEqual([false, false]);
  });
});
