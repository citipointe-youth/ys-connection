// FX2 (2026-10-22): same-name merge reads as "kept"; old Error log lines show their date. Real functions from public/index.html.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, loadFns, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();

describe('FX2 import report', () => {
  it('a same-name merge says rows were combined and nothing dropped, with no rejection wording', () => {
    let out = '';
    const g = new Function('esc', 'modal', `var _drop = () => {}; ${extractFn(html, 'showImportReport')}; return showImportReport;`)((s: unknown) => String(s), (h: string) => { out = h; });
    g({ skippedRows: [], nameCollisions: [{ name: 'Test Student', count: 2 }] });
    expect(out).toContain('Same-name rows combined (nothing dropped)');
    expect(out).toContain('Test Student: 2 rows with the same name were combined into one student, nothing was dropped');
    expect(out).not.toMatch(/rejected|error|failed/i);
    expect(out).not.toContain('Rows skipped');
  });
});

describe('FX2 Error log date', () => {
  const day = 864e5, iso = (ago: number) => new Date(Date.now() - ago).toISOString();
  const f = loadFns(['esc', '_laFmtBrisbane', '_laRelTime', '_elIsNew', '_elRowHtml', 'fmtDay'], 'var S = {};');
  const row = (ago: number) => ({ id: 'x', category: 'link', code: 'no-room', route: 'checkIn', count: 7, counted: true, lastSeen: iso(ago), ignored: false, line1: '7 check-ins refused: no room found', line2: 'l2' });
  it('a line 2+ days old shows "Last on <weekday date>"; a fresh one keeps the relative time', () => {
    expect(f._elRowHtml(row(3 * day), Date.now(), false)).toMatch(/el-when">Last on (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2}/);
    expect(f._elRowHtml(row(3 * 36e5), Date.now(), false)).toContain('el-when">3h ago');
  });
});
