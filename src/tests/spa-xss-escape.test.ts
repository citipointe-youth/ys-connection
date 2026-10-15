import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

// Audit 2026-10-12 H2: a grade login could name a leader `<img src=x onerror=...>` and the
// student-detail "Leader Assignments" list rendered it raw, stealing the next admin's token.
const HOSTILE = '<img src=x onerror=alert(1)>';

describe('leader names render inert', () => {
  it('student detail: a hostile leader name is escaped in Leader Assignments', async () => {
    const f = loadFns(['esc', 'dncBanner', 'showStudentDetail'],
      `let _sdStudent, _sdLeaders, _sdAssigned; let html = '';
       const S = { user: { role: 'admin' } };
       const API = { get: async (p) => p.startsWith('/students/') ? { id: 's1', firstName: 'Jess', lastName: 'Tran', grade: 9, gender: 'female', grpTotal: 0 }
         : p.startsWith('/connections/student/') ? [{ leaderId: 'L1', leaderName: ${JSON.stringify(HOSTILE)} }] : [] };
       function modal(h) { html = h; } function toast() {}
       function svcPct() { return null; } function quadChip() { return ''; } function qualChips() { return ''; }
       function fmtBday() { return ''; } function pBar() { return ''; } function L(k) { return k; }
       function phoneLink() { return ''; } function termRow() { return ''; } function icS() { return ''; } function icN() { return ''; }
       function helpTip() { return ''; } function _syncConnectThumb() {} function sdLeaderSearch() {} function _prayersOn() { return false; }
       const document = { getElementById: () => null };
       function __h() { return html; }`,
      ['showStudentDetail', '__h']);
    await f.showStudentDetail('s1');
    const html = f.__h();
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain(HOSTILE);
  });

  it('Connect picker: the "with <leader>" note is escaped', () => {
    const f = loadFns(['esc', 'pickerRow'],
      `function svcPct() { return null; } function isRising() { return false; } function _qualChip() { return ''; }
       function quadChip() { return ''; } function qualChips() { return ''; } function icS() { return ''; } function pBar() { return ''; }`,
      ['pickerRow']);
    const html = f.pickerRow({ id: 's1', firstName: 'Jess', lastName: 'Tran', grade: 9, gender: 'female' }, false, 'with ' + HOSTILE);
    expect(html).not.toContain(HOSTILE);
    expect(html).toContain('&lt;img');
  });
});
