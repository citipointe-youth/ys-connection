// Modular-setup Task 2.0: shared hide plumbing. MP1 = _modOn; MP1b = the page dispatcher sends an off module's page Home.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';
import { navWithModules, expectSubtraction } from './helpers/module-off';
import { MinistryConfigSchema } from '../core/ministry-config';
import { consentsHubOn } from '../core/module-tree';

const modOn = (role: string | null, modules: Record<string, unknown> | undefined, key: string): boolean =>
  loadFns(['_modOn'], `var S = ${JSON.stringify({ user: role ? { role } : null, settings: { ministryConfig: modules ? { modules } : {} } })};`)._modOn(key);

describe('MP1 _modOn', () => {
  it('on: true and "on" are on; false and "off" are off', () => {
    expect(modOn('leader', { prayers: true }, 'prayers')).toBe(true);
    expect(modOn('leader', { flows: 'on' }, 'flows')).toBe(true);
    expect(modOn('leader', { prayers: false }, 'prayers')).toBe(false);
    expect(modOn('admin', { flows: 'off' }, 'flows')).toBe(false);
  });
  it('admin mode counts as on only for an admin login', () => {
    expect(modOn('leader', { checkin: 'admin' }, 'checkin')).toBe(false);
    expect(modOn('director', { checkin: 'admin' }, 'checkin')).toBe(false);
    expect(modOn(null, { checkin: 'admin' }, 'checkin')).toBe(false);
    expect(modOn('admin', { checkin: 'admin' }, 'checkin')).toBe(true);
  });
  it('unknown shows: settings or modules not loaded = on', () => {
    expect(modOn('leader', undefined, 'flows')).toBe(true);
  });
  it('consentsHub follows consentsHubOn for every busConsentForm x intakeAdmin pair', () => {
    for (const busConsentForm of [true, false]) {
      for (const intakeAdmin of ['on', 'off']) {
        const m = MinistryConfigSchema.parse({ modules: { busConsentForm, intakeAdmin } }).modules;
        expect(modOn('admin', m as any, 'consentsHub'), `${busConsentForm}/${intakeAdmin}`).toBe(consentsHubOn(m));
      }
    }
  });
});

describe('MP1b page dispatcher guard', () => {
  // Runs the real render() from index.html with a fake PAGE_MODULE and every unknown name stubbed; returns the go() calls.
  const run = async (page: string, pageModule: Record<string, string>, modules: Record<string, unknown>) => {
    const went: string[] = [];
    const NOOP: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : NOOP), apply: () => '' });
    const env: Record<string, any> = {
      S: { user: { role: 'admin' }, page, settings: { ministryConfig: { modules } } }, PAGE_MODULE: pageModule, _shellReady: true, go: (p: string) => went.push(p),
    };
    const scope = new Proxy(env, {
      has: (_t, k) => typeof k === 'string' && !k.startsWith('__') && !(k in globalThis),
      get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : NOOP),
    });
    const html = loadIndexHtml();
    // eslint-disable-next-line no-new-func
    await new Function('__env', `with (__env) { ${extractFn(html, '_modOn')}\n${extractFn(html, 'render')}\n return render(); }`)(scope);
    return went;
  };
  it('sends the page of an off module to Home', async () => {
    expect(await run('trends', { trends: 'fakeMod' }, { fakeMod: false })).toEqual(['home']);
  });
  it('lets the page through when its module is on, or when it has no entry', async () => {
    expect(await run('trends', { trends: 'fakeMod' }, { fakeMod: true })).toEqual([]);
    expect(await run('trends', {}, { fakeMod: false })).toEqual([]);
  });
  it('the shipped PAGE_MODULE map starts empty', () => {
    expect(loadIndexHtml()).toMatch(/^const PAGE_MODULE = \{\};\r?$/m);
  });
});

describe('module-off helper', () => {
  it('navWithModules: turning Prayer off removes exactly the prayers entries (expectSubtraction)', () => {
    const base = navWithModules('admin');
    expect(base.nav.length).toBeGreaterThan(0);
    expectSubtraction(base, navWithModules('admin', { prayers: false }), ['prayers']);
  });
  it('expectSubtraction fails when the off render drops something else', () => {
    const base = navWithModules('admin');
    expect(() => expectSubtraction(base, navWithModules('admin', { prayers: false }), ['notices'])).toThrow();
  });
});
