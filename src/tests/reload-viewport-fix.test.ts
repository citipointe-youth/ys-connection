import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

// Runs the REAL _reloadViewportFix body from public/index.html against stubs.
// It can't prove the iOS layout effect (no WebKit here) — it pins the parts that would
// break every page if wrong: the viewport meta comes back byte-identical, and the toggle
// only happens on a reload in the installed home-screen app.

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
    const setTimeout = (fn) => { __timers.push(fn); };
    const requestAnimationFrame = (fn) => { __frames.push(fn); };
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

  it('does nothing on a normal launch', () => {
    expect(run({ standalone: true, navType: 'navigate' }).seen).toEqual([]);
    expect(run({ standalone: true, navType: null }).seen).toEqual([]);
  });

  it('runs from boot()', () => {
    expect(extractFn(loadIndexHtml(), 'boot')).toContain('_reloadViewportFix()');
  });
});

