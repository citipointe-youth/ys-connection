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
describe('r21 L6b (T9) Who? > Send again', () => {
  const who = html.slice(html.indexOf('async function elWho('), html.indexOf('// end elWho'));
  it('check-in, report and member rows get a Send again button; the other sections do not', () => {
    expect((who.match(/_elRsBtn\(/g) || []).length).toBe(3);
    expect(who).toContain("kind: 'checkin', personId: x.personId, date: x.date");
    expect(who).toContain("kind: 'lifegroup', groupId: x.groupId, date: x.date");
    expect(who).toContain("kind: 'member', groupId: x.groupId, personId: x.personId, op: x.op");
  });
  it('elResend asks first (two taps), then posts one row to the resend endpoint', () => {
    const fn = html.slice(html.indexOf('async function elResend('), html.indexOf('// end elResend'));
    expect(fn).toContain("dataset.armed !== '1'");
    expect(fn).toContain("API.post('/admin/reconcile/resend', _elRs[i])");
  });
});
