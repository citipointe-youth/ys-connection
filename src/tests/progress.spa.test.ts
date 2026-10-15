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

describe('intake Refresh ask: Sent > Console picked up > Reading Elvanto', () => {
  const { _ikRefBar } = loadFns(['progBar', '_ikRefBar'], ESC);
  const ref = { mode: 'consent', date: '2026-10-16', since: Date.parse('2026-10-16T09:00:00Z') };
  it('step 1 until the console claims after the ask, then 2, then the console\'s own stage at 3', () => {
    expect(_ikRefBar(ref, { console: { lastSeenAt: '2026-10-16T08:59:00Z', progress: {} } })).toContain('aria-valuenow="1"');
    expect(_ikRefBar(ref, { console: { lastSeenAt: '2026-10-16T09:00:10Z', progress: {} } })).toContain('Console picked up');
    const h = _ikRefBar(ref, { console: { lastSeenAt: '2026-10-16T09:00:10Z', progress: { 'intake:consent:2026-10-16': { done: null, total: null, stage: 'Reading Elvanto' } } } });
    expect(h).toContain('aria-valuenow="3"');
    expect(h).toContain('Reading Elvanto');
    expect(_ikRefBar(ref, null)).toContain('Sent, waiting for the console'); // an older app head: no console block
  });
});

describe('consent lookups: the bar follows the poll', () => {
  const { _ikLkStatusHtml, _ikLkApply } = loadFns(['progBar', '_ikSeenLine', '_ikLkReason', '_ikLkApply', '_ikLkStatusHtml'],
    `${ESC} function _lkSeen() { return 'just now'; } function icS() { return ''; }`);
  it('working with progress -> determinate; without (an older console) -> sliding', () => {
    const x: Record<string, unknown> = { kind: 'forms', since: 0, st: 'waiting' };
    expect(_ikLkApply(x, { status: 'working', progress: { done: 2, total: 7, stage: 'Reading forms' } }, 1000)).toBe(true);
    expect(_ikLkStatusHtml('forms', x, null)).toContain('2 of 7');
    _ikLkApply(x, { status: 'working' }, 1000);
    expect(_ikLkStatusHtml('forms', x, null)).toContain('pbar-fill ind');
    expect(_ikLkStatusHtml('forms', { st: 'asking' }, null)).toContain('Sending your search');
  });
});
