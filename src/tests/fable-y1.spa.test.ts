import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

// Fable review round, lane A, batch Y1. Runs the REAL functions from public/index.html with stubbed globals.
const html = loadIndexHtml();

const sliceTo = (start: string, end: string) => {
  const i = html.indexOf(start);
  if (i < 0) throw new Error('missing ' + start);
  return html.slice(i, html.indexOf(end, i) + end.length);
};
const REAL_API = sliceTo('const API = (() => {', '\n})();');
const REAL_CACHE = sliceTo('const Cache = (() => {', '\n})();');
const SECTION_OF = sliceTo('const SECTION_OF = {', '\n};');

// ── Y1-1 / Y1-3: cold Home ──
function homeHarness(o: { role?: string; notices?: boolean; realApi?: boolean; batch?: (paths: string[]) => Promise<any> } = {}) {
  const calls = { setApp: [] as string[], homeError: 0, urls: [] as string[], batchPaths: [] as string[][] };
  const S: any = { user: { role: o.role || 'admin', id: 'u1' }, page: 'home', settings: { ministryConfig: { modules: o.notices ? { notices: 'on' } : {} } } };
  const env: Record<string, any> = {
    S, calls,
    setApp: (h: string) => calls.setApp.push(h),
    shell: (b: string) => 'shell:' + b,
    renderLeaderHome: () => {},
    _renderHomeInner: async () => { calls.setApp.push('home-body'); },
    _revalidateHome: () => {},
    _homeError: () => { calls.homeError++; },
    fetch: (url: string) => { calls.urls.push(url); return Promise.resolve({ ok: true, json: async () => ({ results: {} }) }); },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    _npStart: () => {}, _npDone: () => {}, _errReport: () => {}, _errRoute: () => '', _plainErr: (_m: any, _s: any, _c: any, said: string) => said,
    _validationText: () => null, _handleAuthExpired: () => {}, _moduleOffHit: () => {}, _moduleDisabledRefresh: () => {},
    _lsGet: () => null, _isAuthExpired: () => false,
  };
  const apiSrc = o.realApi === false
    ? `const Cache = { get: () => null, getStale: () => null };\nconst API = { batch: (p) => { calls.batchPaths.push(p); return __batch(p); }, get: () => Promise.resolve(null) };`
    : `${SECTION_OF}\n${REAL_CACHE}\n${REAL_API}`;
  env.__batch = o.batch || (() => Promise.resolve([]));
  const names = ['_prefetch', 'renderHome', 'HOME_PATHS', '_noticesOn', '_prayersOn'];
  const prefetchP = html.match(/^let _prefetchP = null;/m);
  const fns = new Function(...Object.keys(env),
    `${apiSrc}\n${prefetchP ? prefetchP[0] : 'var _prefetchP;'}\n${names.map((n) => extractFn(html, n)).join('\n')}\nreturn { ${names.join(', ')} };`,
  )(...Object.values(env));
  return { fns, S, calls };
}
const defer = () => { let go!: (v?: any) => void; const p = new Promise<any>((r) => { go = r; }); return { p, go }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Y1-1 cold Home after the user moved on', () => {
  it('does not paint after a page change', async () => {
    const d = defer();
    const h = homeHarness({ realApi: false, batch: () => d.p });
    const run = h.fns.renderHome();
    await tick();
    const before = h.calls.setApp.length;
    h.S.page = 'import';
    d.go([]);
    await run;
    expect(h.calls.setApp.length).toBe(before);
  });
  it('paints no error after logout', async () => {
    const d = defer();
    const h = homeHarness({ realApi: false, batch: () => d.p });
    h.fns.renderHome();
    await tick();
    h.S.user = null;
    d.go([]);
    await tick(); await tick();
    expect(h.calls.homeError).toBe(0);
    expect(h.calls.setApp.filter((x) => x === 'home-body').length).toBe(0);
  });
});

describe('Y1-3 login sends one /batch', () => {
  it.each(['admin', 'quad'])('prefetch then cold Home: one /batch URL (%s)', async (role) => {
    const h = homeHarness({ role });
    h.fns._prefetch();
    await h.fns.renderHome();
    expect(h.calls.urls.filter((u) => u.startsWith('/batch')).length).toBe(1);
  });
  it.each(['admin', 'oversight', 'quad', 'grade'])('the prefetch list covers HOME_PATHS (%s)', (role) => {
    for (const notices of [false, true]) {
      const h = homeHarness({ role, notices, realApi: false });
      h.fns._prefetch();
      const sent = h.calls.batchPaths[0]!;
      for (const p of h.fns.HOME_PATHS()) expect(sent).toContain(p);
      if (notices && h.fns._noticesOn()) expect(sent).toContain('/notices');
      else expect(sent).not.toContain('/notices');
    }
  });
  it('a rejected prefetch still paints Home', async () => {
    const h = homeHarness({ realApi: false, batch: () => Promise.reject(new Error('down')) });
    h.fns._prefetch();
    await h.fns.renderHome();
    expect(h.calls.setApp.filter((x) => x === 'home-body').length).toBe(1);
  });
});
