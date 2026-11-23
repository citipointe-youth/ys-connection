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
