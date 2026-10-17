import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const html = readFileSync('public/index.html', 'utf8');
describe('Who? sheet', () => {
  it('defines elWho, reads the admin endpoint and escapes every name', () => {
    const fn = html.slice(html.indexOf('async function elWho('), html.indexOf('// end elWho'));
    expect(fn.length).toBeGreaterThan(50);
    expect(fn).toContain("'/admin/reconcile/latest'");
    expect(fn).not.toMatch(/\$\{(?:x\.)?(name|group|m)\}/); // every name goes through esc()
  });
  it('_elRowHtml shows Who? only on reconcile rows with a section', () => {
    const row = html.slice(html.indexOf('function _elRowHtml('), html.indexOf('function _elBodyHtml('));
    expect(row).toContain("r.category === 'reconcile' && r.code !== 'recon-failed'");
    expect(row).toContain('elWho(');
  });
});
