// Round 2026-10-22 admin lane L5, B7: the System check shows fix rows first and folds the rest.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

const html = loadIndexHtml();
const ST = { checks: [
  { id: 'db', label: 'Database connection', state: 'ok' },
  { id: 'google', label: 'Google: not set up', state: 'optional' },
  { id: 'sessionSecret', label: 'SESSION_SECRET', state: 'fix', fix: 'Set it in Vercel.' },
] };

describe('B7 System check fold', () => {
  const { _setupChecklistHtml } = loadFns(['_setupChecklistHtml'],
    'const SETUP = { generated: {} }; function esc(s) { return String(s); } function icS(k) { return "[" + k + "]"; }');
  it('with fold: fix rows first, open; ok and optional rows inside a closed <details>', () => {
    const h = _setupChecklistHtml(ST, { generate: true, fold: true });
    const det = h.indexOf('<details');
    expect(det).toBeGreaterThan(-1);
    expect(h.indexOf('SESSION_SECRET')).toBeLessThan(det);
    expect(h.indexOf('Database connection')).toBeGreaterThan(det);
    expect(h.indexOf('Google: not set up')).toBeGreaterThan(det);
    expect(h).toContain('Show all checks');
    expect(h).not.toMatch(/<details[^>]* open/);
  });
  it('with fold and nothing to fix: one closed line says so', () => {
    const h = _setupChecklistHtml({ checks: ST.checks.filter((c) => c.state !== 'fix') }, { fold: true });
    expect(h).toContain('Nothing to fix. Show all checks');
  });
  it('without fold (first-run Set up page): every row in order, no <details>', () => {
    const h = _setupChecklistHtml(ST, { generate: true });
    expect(h).not.toContain('<details');
    expect(h.indexOf('Database connection')).toBeLessThan(h.indexOf('SESSION_SECRET'));
  });
  it('the System check, its heading and its Generate repaint use the fold; renderSetup does not', () => {
    expect(html).toMatch(/function renderSystemCheck[\s\S]*?_setupChecklistHtml\(SETUP\.status, \{ generate: true, fold: true \}\)/);
    expect(html).toMatch(/function renderSystemCheck[\s\S]*?<div class="lk-sec">System check<\/div>/);
    expect(html).toMatch(/function setupGenerate[\s\S]*?_setupChecklistHtml\(SETUP\.status, \{ generate: true, fold: true \}\)/);
    expect(html).toMatch(/function renderSetup[\s\S]*?_setupChecklistHtml\(st, \{ generate: true \}\)/);
  });
});
