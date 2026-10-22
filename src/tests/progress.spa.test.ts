// S5 (run 2026-10-15b): the one progress bar, and the three waits that carry the console's real progress.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

const ESC = `function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }`;

describe('progBar', () => {
  const { progBar } = loadFns(['progBar'], ESC);
  it('known numbers: a determinate, accessible bar with "n of N" and a width', () => {
    const h = progBar('Reading the form list', 3, 40);
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="3"');
    expect(h).toContain('aria-valuemax="40"');
    expect(h).toContain('3 of 40');
    expect(h).toContain('width:8%');
    expect(h).not.toContain(' ind');
  });
  it('unknown numbers: an indeterminate sliding bar, no aria-valuenow; done is capped at total; the stage is escaped', () => {
    const h = progBar('<b>x</b>');
    expect(h).toContain('pbar-fill ind');
    expect(h).not.toContain('aria-valuenow');
    expect(h).toContain('&lt;b>x');
    expect(progBar('x', null, 5)).toContain(' ind');
    expect(progBar('x', 9, 5)).toContain('aria-valuenow="5"');
    expect(progBar('x', 0, 0)).toContain(' ind');
  });
  it('reduced motion stops the slide; no Loading… or Asking the console… text is left', () => {
    const src = loadIndexHtml();
    expect(src).toMatch(/@media\(prefers-reduced-motion:reduce\)\{\.pbar-fill\.ind\{animation:none/);
    expect(src).not.toMatch(/Loading…|Loading\.\.\.|Asking the console/);
  });
});
