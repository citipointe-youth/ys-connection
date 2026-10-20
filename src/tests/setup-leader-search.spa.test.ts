// I3 (R2 2026-10-17): Connect Setup leader search box, admin/director only.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const mk = (role: string, lq = '') => loadFns(['renderConnectView', '_csLeaderQ'], `
  let html = ''; const focused = [];
  const _aS = { students: [], allocs: {}, gf: new Set(), df: new Set(), lq: ${JSON.stringify(lq)},
    leaders: [{ id: 'l1', fullName: 'Amy Test', grades: [8], gender: 'female' }, { id: 'l2', fullName: 'Ben Sample', grades: [9], gender: 'male' }] };
  const S = { user: { role: ${JSON.stringify(role)}, quad: 'g79' } };
  function _vgActive() { return false; } function _vgGrades() { return []; } function _vgLeaders(l) { return l; } function _vgStudents(s) { return s; }
  function _vgBar() { return ''; } function userGrades() { return [8]; } function _hasAttended() { return true; }
  function quadGrades() { return [7, 8, 9]; } function _gradeList() { return [7, 8, 9]; } function _pickByFirst() { return 0; }
  function helpTip() { return ''; } function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function icS() { return ''; } function icEmpty() { return ''; } function _inactiveLeadersHtml() { return ''; }
  function shell(b) { return b; } function setApp(h) { html = h; }
  const cards = [{ dataset: { name: 'amy test' }, style: { display: '' } }, { dataset: { name: 'ben sample' }, style: { display: '' } }];
  const document = { activeElement: null, querySelectorAll(q) { return q === '.connect-students' ? [] : cards; }, getElementById() { return null; } };
  function _syncConnectThumb() {}
  function __html() { return html; } function __cards() { return cards; } function __aS() { return _aS; }`,
['renderConnectView', '_csLeaderQ', '__html', '__cards', '__aS']);

describe('I3 Connect Setup leader search', () => {
  it('the box is inside the director/admin (+ quad, r21 L1) gate, and cards carry data-name', () => {
    const src = extractFn(loadIndexHtml(), 'renderConnectView');
    expect(src).toMatch(/showSearch \? `<div class="sbar">[^`]*id="cs-lq"/);
    expect(src).toContain("const showSearch = showGender || u.role === 'quad';");
    expect(src).toContain("const showGender = ['director','admin'].includes(u.role);");
    expect(src).toContain('data-name="${esc(l.fullName.toLowerCase())}"');
    expect(src).toContain('oninput="_csLeaderQ(this.value)"');
  });
  it('_csLeaderQ hides the cards that do not match', () => {
    const f = mk('admin');
    f._csLeaderQ('  AMY ');
    expect(f.__aS().lq).toBe('amy');
    expect(f.__cards().map((c: any) => c.style.display)).toEqual(['', 'none']);
    f._csLeaderQ('');
    expect(f.__cards().map((c: any) => c.style.display)).toEqual(['', '']);
  });
  it('a repaint with a search set keeps only matching leaders visible', () => {
    const f = mk('director', 'ben');
    f.renderConnectView();
    const h = f.__html();
    expect(h).toContain('id="cs-lq"');
    expect(h).toContain('value="ben"');
    expect(h).toMatch(/data-name="amy test" style="display:none"/);
    expect(h).toMatch(/data-name="ben sample">/);
  });
  it('a grade login has no search box and nothing hidden', () => {
    const f = mk('grade', 'ben');
    f.renderConnectView();
    expect(f.__html()).not.toContain('cs-lq');
    expect(f.__html()).not.toContain('display:none');
  });
});
