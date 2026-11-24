import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

// Runs the REAL _reloadViewportFix body from public/index.html against stubs.
// It can't prove the iOS layout effect (no WebKit here) — it pins the parts that would
// break every page if wrong: the viewport meta comes back byte-identical, and the toggle
// only happens in the installed home-screen app.

function run(opts: { standalone: boolean; navType: string | null }) {
  const html = loadIndexHtml();
  const original = /<meta name="viewport" content="([^"]+)">/.exec(html)![1]!;
  const meta = { content: original };
  const seen: string[] = [];
  const timers: Array<() => void> = [];
  const frames: Array<() => void> = [];
  const prelude = `
    const navigator = { standalone: ${opts.standalone} };
    const performance = { getEntriesByType: () => ${opts.navType ? `[{ type: '${opts.navType}' }]` : '[]'} };
    const document = { querySelector: () => __meta };
    const setTimeout = (fn) => { if (fn !== _vpCheck) __timers.push(fn); };
    const requestAnimationFrame = (fn) => { __frames.push(fn); };
    const _vpSnap = () => {}, _vpCheck = () => {};
  `;
  const { _reloadViewportFix } = new Function('__meta', '__timers', '__frames',
    `${prelude}\n${extractFn(html, '_reloadViewportFix')}\nreturn { _reloadViewportFix };`,
  )(meta, timers, frames);
  _reloadViewportFix();
  while (timers.length || frames.length) {
    (timers.shift() ?? frames.shift())!();
    seen.push(meta.content);
  }
  return { original, final: meta.content, seen };
}

describe('_reloadViewportFix (iOS home-screen reload gap)', () => {
  it('drops viewport-fit=cover for a moment, then restores the exact original tag', () => {
    const r = run({ standalone: true, navType: 'reload' });
    expect(r.original).toContain(', viewport-fit=cover');
    expect(r.seen[0]).toBe(r.original.replace(', viewport-fit=cover', ''));
    expect(r.final).toBe(r.original);
  });

  it('does nothing outside the installed app', () => {
    const r = run({ standalone: false, navType: 'reload' });
    expect(r.seen).toEqual([]);
    expect(r.final).toBe(r.original);
  });

  it('runs on every launch of the installed app, not only reloads (24 Nov: gap on a plain open)', () => {
    expect(run({ standalone: true, navType: 'navigate' }).final).toBe(run({ standalone: true, navType: 'navigate' }).original);
    expect(run({ standalone: true, navType: 'navigate' }).seen.length).toBe(3);
    expect(run({ standalone: true, navType: null }).seen.length).toBe(3);
  });

  it('runs from boot()', () => {
    expect(extractFn(loadIndexHtml(), 'boot')).toContain('_reloadViewportFix()');
  });

  it('runs before the first render, once', () => {
    const boot = extractFn(loadIndexHtml(), 'boot');
    expect(boot.split('_reloadViewportFix()').length - 1).toBe(1);
    expect(boot.indexOf('_reloadViewportFix()')).toBeGreaterThan(-1);
    expect(boot.indexOf('_reloadViewportFix()')).toBeLessThan(boot.indexOf('render()'));
  });
});


// 24 Nov: inner 812 on an 874 screen with safe-top 62 = the stale state; a 1px scroll imitates the healing touch.
function check(o: { standalone: boolean; inner: number; screen: number; top: number }) {
  const scrolls: number[] = [];
  const frames: Array<() => void> = [];
  const h = { style: { minHeight: '' } };
  const { _vpCheck } = new Function('__s', '__f', '__h', `
    const _vpSnap = () => ${o.top};
    const navigator = { standalone: ${o.standalone} }, innerHeight = ${o.inner}, screen = { height: ${o.screen} };
    const document = { documentElement: __h };
    const window = { scrollTo: (x, y) => __s.push(y) };
    const requestAnimationFrame = (fn) => __f.push(fn), setTimeout = () => {};
    ${extractFn(loadIndexHtml(), '_vpCheck')}
    return { _vpCheck };`)(scrolls, frames, h);
  _vpCheck();
  while (frames.length) frames.shift()!();
  return { scrolls, minHeight: h.style.minHeight };
}

describe('_vpCheck (stale safe-area state)', () => {
  it('nudges 1px and back, then clears the min-height, in the stale state', () => {
    expect(check({ standalone: true, inner: 812, screen: 874, top: 62 })).toEqual({ scrolls: [1, 0], minHeight: '' });
  });
  it('leaves a healthy phone alone', () => {
    expect(check({ standalone: true, inner: 874, screen: 874, top: 62 }).scrolls).toEqual([]); // page under the bar, as designed
    expect(check({ standalone: true, inner: 812, screen: 874, top: 0 }).scrolls).toEqual([]);  // healed: band outside the page
    expect(check({ standalone: false, inner: 812, screen: 874, top: 62 }).scrolls).toEqual([]);
  });
});
