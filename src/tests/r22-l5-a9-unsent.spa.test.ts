// Round 2026-10-22 admin lane L5, A9: Unsent new people copy safety, and its own heading (Problems tab).
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

function env(rows: unknown[], tab = 'problems') {
  return loadFns(['_usRowHtml', '_usPaint', 'usDelete'], `
    const el = { innerHTML: '' }, btn = { dataset: {}, textContent: 'Delete' };
    const document = { getElementById: (id) => id === 'unsent-list' ? el : id.indexOf('us-del-') === 0 ? btn : null };
    function esc(s) { return String(s); }
    const _laFmtBrisbane = (s) => s, _laRelTime = (s) => s;
    const US_REASON = { 'form-changed': 'The Elvanto form had changed' };
    const _usBusy = new Set();
    const _adminTab = ${JSON.stringify(tab)};
    let _usRows = ${JSON.stringify(rows)};
    const API = { del: async () => {} };
    function toast() {}
    function __o() { return { el, btn }; }`, ['_usRowHtml', '_usPaint', 'usDelete', '__o']);
}
const ROW = { id: 'u1', name: 'Zed Testperson', grade: '9', reason: 'form-changed', forms: ['student'], host: 'Pat Example', createdAt: 'x', updatedAt: 'x' };

describe('A9 Unsent copy', () => {
  it('says "added by", not "host"', () => {
    const h = env([])._usRowHtml(ROW);
    expect(h).toContain('added by Pat Example');
    expect(h).not.toContain('host ');
  });
  it('a form-changed row tells the admin the way out; other reasons do not', () => {
    expect(env([])._usRowHtml(ROW)).toContain('Retry works after the form fix. Ask Pat Example for their details, or enter them in Elvanto by hand.');
    expect(env([])._usRowHtml({ ...ROW, reason: 'failed' })).not.toContain('Retry works after the form fix');
  });
  it('a form-changed row with no adder still reads plainly', () => {
    expect(env([])._usRowHtml({ ...ROW, host: '' })).toContain('Ask the leader who added them for their details');
  });
  it('the help line warns that deleting loses the details, under a heading', () => {
    const f = env([ROW]);
    f._usPaint();
    const h = f.__o().el.innerHTML;
    expect(h).toContain('Unsent new people');
    expect(h).toContain('Deleting loses their details.');
  });
  it('empty: paints nothing inside Problems, but the old Unsent tab still says so', () => {
    const f = env([]);
    f._usPaint();
    expect(f.__o().el.innerHTML).toBe('');
    const g = env([], 'unsent');
    g._usPaint();
    expect(g.__o().el.innerHTML).toContain('Nothing waiting to resend.');
  });
  it('the second Delete tap asks "Delete for good?"', async () => {
    const f = env([ROW]);
    await f.usDelete('u1');
    expect(f.__o().btn.textContent).toBe('Delete for good?');
  });
});
