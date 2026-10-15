import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

// Fix round 16 Oct 2026, lane B (shell / CSS / SW). Runs the REAL functions from public/index.html.
const html = loadIndexHtml();
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

// ── F-07: a new SW build reloads the page only when nothing is mid-task ──
function swHarness(st: { sending?: boolean; modal?: string; page?: string; ny?: Record<string, string>; ik?: any; queue?: any[]; vis?: string }) {
  const reloads: number[] = [];
  const appended: any[] = [];
  const env = {
    NY: { sending: !!st.sending },
    S: { page: st.page || 'home', user: { id: 'u1' } },
    LINK: { ik: st.ik || null },
    _nyRaw: () => st.ny || {},
    _lkQGet: () => st.queue || [],
    location: { reload: () => reloads.push(1) },
    document: {
      visibilityState: st.vis || 'visible',
      getElementById: (id: string) => (id === 'modal-root' ? { innerHTML: st.modal || '' } : null),
      createElement: () => ({}),
      body: { appendChild: (el: any) => appended.push(el) },
    },
  };
  const names = ['_swIdle', '_swReload', '_swOnUpdate', '_swOnHidden'];
  const fns = new Function(...Object.keys(env),
    `let _swReloading = false, _swWaiting = false;\n${names.map((n) => extractFn(html, n)).join('\n')}\nreturn { ${names.join(', ')} };`,
  )(...Object.values(env));
  return { fns, reloads, appended, env };
}

describe('F-07 SW update reload deferral', () => {
  it('reloads at once when idle', () => {
    const h = swHarness({});
    h.fns._swOnUpdate();
    expect(h.reloads.length).toBe(1);
    expect(h.appended.length).toBe(0);
  });
  it.each([
    ['a New person send in flight', { sending: true }],
    ['an open sheet', { modal: '<div class="mo"></div>' }],
    ['a half-typed New person form', { page: 'new-youth', ny: { firstName: 'Tom' } }],
    ['an intake detail open', { page: 'link-intake', ik: { det: { row: {} } } }],
    ['intake answers waiting to send', { page: 'link-intake', ik: { debT: 7 } }],
    ['taps still in the link queue', { queue: [{ id: 'x' }] }],
  ])('does not reload with %s: shows one "Update ready" banner instead', (_n, st) => {
    const h = swHarness(st as any);
    h.fns._swOnUpdate();
    h.fns._swOnUpdate();
    expect(h.reloads.length).toBe(0);
    expect(h.appended.length).toBe(1);
    expect(h.appended[0].textContent).toBe('Update ready. Tap to reload');
    h.appended[0].onclick();
    expect(h.reloads.length).toBe(1);
  });
  it('reloads on the next hide once idle, not while still busy', () => {
    const st: any = { queue: [{ id: 'x' }], vis: 'hidden' };
    const h = swHarness(st);
    h.fns._swOnUpdate();
    h.fns._swOnHidden();
    expect(h.reloads.length).toBe(0);
    st.queue = [];
    h.fns._swOnHidden();
    expect(h.reloads.length).toBe(1);
  });
  it('the controllerchange listener goes through _swOnUpdate', () => {
    expect(html).toMatch(/addEventListener\('controllerchange', \(\) => \{\s*if \(!_swHadController\) return;\s*_swOnUpdate\(\);/);
    expect(html).toContain("document.addEventListener('visibilitychange', _swOnHidden)");
  });
});

// ── F-20(a): 44 px Back and Exit Preview ──
describe('F-20a tap targets', () => {
  it('Back carries .hdr-back and the CSS makes it 44x44; Exit Preview is 44 tall', () => {
    const fn = new Function('S', 'icN', `${extractFn(html, '_hdrBrandHtml')}\nreturn _hdrBrandHtml;`)({ page: 'x' }, () => '<svg></svg>');
    expect(fn()).toContain('class="hdr-back"');
    expect(css).toMatch(/\.hdr-back\{[^}]*min-width:44px;min-height:44px/);
    expect(css).toMatch(/\.preview-banner \.btn\{[^}]*min-height:44px/);
  });
});

// ── F-26: toasts ──
describe('F-26 toast timer', () => {
  it('a second toast is not cut short by the first timer', () => {
    let now = 0;
    const timers: Array<{ at: number; fn: () => void; id: number }> = [];
    let nid = 0;
    const el: any = { textContent: '', classList: { s: new Set<string>(), add(c: string) { this.s.add(c); }, remove(c: string) { this.s.delete(c); } } };
    const env = {
      document: { getElementById: () => el },
      setTimeout: (fn: () => void, ms: number) => { const id = ++nid; timers.push({ at: now + ms, fn, id }); return id; },
      clearTimeout: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    };
    const toast = new Function(...Object.keys(env), `${extractFn(html, 'toast')}\nreturn toast;`)(...Object.values(env));
    const advance = (to: number) => { now = to; timers.filter((t) => t.at <= to).forEach((t) => { timers.splice(timers.indexOf(t), 1); t.fn(); }); };
    toast('one');
    advance(2000);
    toast('two');
    advance(2600); // the first toast's 2.5 s timer would have fired here
    expect(el.classList.s.has('show')).toBe(true);
    advance(4600);
    expect(el.classList.s.has('show')).toBe(false);
  });
  it('#toast rises above a showing Undo toast', () => {
    expect(css).toMatch(/body:has\(\.lk-toast\.show\) #toast\{[^}]*z-index:302/);
  });
});

// ── F-33(B): boot storage reads survive a throwing localStorage ──
describe('F-33 boot storage', () => {
  it('_lsGet returns null when localStorage throws', () => {
    const ls = { getItem: () => { throw new Error('SecurityError'); } };
    const _lsGet = new Function('localStorage', `${extractFn(html, '_lsGet')}\nreturn _lsGet;`)(ls);
    expect(_lsGet('yap_token')).toBe(null);
  });
  it('the API token read and boot() survive a throwing localStorage', async () => {
    expect(html).toContain("let _t = _lsGet('yap_token') || null;");
    const env = {
      localStorage: { getItem: () => { throw new Error('SecurityError'); }, removeItem: () => { throw new Error('x'); } },
      API: { get: async () => ({}), setToken: () => {} }, S: { user: null, settings: null } as any, _previewStash: null,
      restoreConnectFilters: () => {}, restoreArFilter: () => {}, restorePrayerFilter: () => {}, applyTheme: () => {},
      render: () => {}, _reloadViewportFix: () => {}, _isAuthExpired: () => false, location: { search: '' },
    };
    const boot = new Function(...Object.keys(env), `${extractFn(html, 'boot')}
return boot;`)(...Object.values(env));
    await expect(boot()).resolves.toBeUndefined();
  });
});

// ── F-40(a), F-44, F-45, F-47(f), F-48(b): CSS ──
describe('CSS fixes', () => {
  it('F-40a report tick border is #64748b', () => {
    expect(css).toMatch(/\.lk-box\{border:2px solid #64748b\}/);
  });
  it('F-44 DNC red #b91c1c, inactive nav label --ink-mid, nav label 11 px', () => {
    expect(css).toMatch(/\.c-dnc\{background:#b91c1c/);
    expect(css).toMatch(/\.dnc-banner\{[^}]*background:#b91c1c/);
    expect(css).toMatch(/\.bot-nav a\{flex:1;[^}]*color:var\(--ink-mid\)/);
    expect(css).toMatch(/\.bot-nav a span\{font-size:11px/);
  });
  it('F-45 inputs 16 px with a #94a3b8 border; the viewport meta is unchanged', () => {
    expect(css).toMatch(/\.fi,\.fs,\.ft\{[^}]*border:1\.5px solid #94a3b8;[^}]*font-size:16px/);
    expect(css).toMatch(/\.sbar input\{[^}]*border:1\.5px solid #94a3b8;[^}]*font-size:16px/);
    expect(html).toContain('maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  });
  it('F-47f the Prayers page clears the floating Add Prayer pill', () => {
    expect(css).toMatch(/\.pg:has\(\.pfab\)\{padding-bottom:calc\(164px \+ var\(--safe-b\)\)\}/);
  });
  it('F-48b preview banner does not wrap the header; empty sheet bullets hidden', () => {
    expect(css).toMatch(/\.preview-banner>span\{[^}]*white-space:nowrap/);
    expect(css).toMatch(/\.mo-box li:empty\{display:none\}/);
  });
});

// ── F-47(a): the in-page Loading bar waits 400 ms ──
describe('F-47a loader flash', () => {
  const progBar = new Function(`${extractFn(html, 'esc')}\n${extractFn(html, 'progBar')}\nreturn progBar;`)();
  it('a plain Loading bar gets the delayed class; a determinate or named one does not', () => {
    expect(progBar('Loading')).toContain('class="pbar pbar-wait"');
    expect(progBar()).toContain('class="pbar pbar-wait"');
    expect(progBar('Loading', 1, 3)).not.toContain('pbar-wait');
    expect(progBar('Asking the console')).not.toContain('pbar-wait');
    expect(css).toMatch(/\.pbar-wait\{animation:pbar-in 0s \.4s both\}/);
  });
});

// ── F-50(c): auth expiry drops the in-memory link lists ──
describe('F-50c _handleAuthExpired', () => {
  it('calls _lkSoftReset on a normal (non-preview) expiry', () => {
    const calls: string[] = [];
    const env = {
      _previewStash: null, _authExpiring: false,
      setTimeout: () => 0, navReset: () => {}, API: { setToken: () => {} }, S: {} as any,
      _vgReset: () => {}, toast: () => {}, render: () => {}, _lkSoftReset: () => calls.push('reset'),
    };
    const fn = new Function(...Object.keys(env), `let _shellReady;\n${extractFn(html, '_handleAuthExpired')}\nreturn _handleAuthExpired;`)(...Object.values(env));
    fn();
    expect(calls).toEqual(['reset']);
  });
});

// ── F-51: color-scheme meta ──
describe('F-51 color-scheme', () => {
  it('declares a light colour scheme', () => {
    expect(html).toContain('<meta name="color-scheme" content="light">');
  });
});

// ── F-52: tap-through guard + SW offline match ──
describe('F-52', () => {
  it('closeModal blocks taps on #app for 350 ms', () => {
    const app: any = { style: {} };
    let later: (() => void) | null = null, ms = 0;
    const root: any = { _onClose: null, innerHTML: 'x' };
    const env = {
      document: { getElementById: (id: string) => (id === 'app' ? app : root) },
      setTimeout: (fn: () => void, t: number) => { later = fn; ms = t; },
      clearTimeout: () => {},
    };
    const closeModal = new Function(...Object.keys(env), `${extractFn(html, 'closeModal')}\nreturn closeModal;`)(...Object.values(env));
    closeModal();
    expect(app.style.pointerEvents).toBe('none');
    expect(ms).toBe(350);
    later!();
    expect(app.style.pointerEvents).toBe('');
  });
  it('sw.js serves the cached shell for /?nav=notices offline (ignoreSearch)', async () => {
    const src = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
    const handlers: Record<string, any> = {};
    const seen: any[] = [];
    const self = { addEventListener: (t: string, f: any) => { handlers[t] = f; } };
    const caches = { match: (req: any, opts: any) => { seen.push(opts); return Promise.resolve('shell'); }, open: () => Promise.resolve({ put() {} }) };
    const fetch = () => Promise.reject(new TypeError('offline'));
    new Function('self', 'caches', 'fetch', src)(self, caches, fetch);
    let out: any;
    handlers.fetch({ request: { method: 'GET', url: 'https://x.test/?nav=notices' }, respondWith: (p: any) => { out = p; } });
    expect(await out).toBe('shell');
    expect(seen[0]).toEqual({ ignoreSearch: true });
  });
});
