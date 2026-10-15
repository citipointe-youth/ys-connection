// Lane A (fix round 16 Oct) F-01: the Home pickers use the strict /leaders?pick=1 list; Bus does not.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, loadFns } from './helpers/extract-fn';

const html = loadIndexHtml();

describe('F-01 SPA pickers', () => {
  it('Home "Choose your name" and My Connections pickers fetch /leaders?pick=1', () => {
    expect(extractFn(html, 'renderHomeFollowup')).toContain("G('/leaders?pick=1')");
    const ms = extractFn(html, 'renderMyStudents');
    expect(ms).toContain("API.get('/leaders?pick=1')");
    expect(ms).not.toMatch(/['"]\/leaders['"]/);
    expect(html).toContain("const MYSTUDENTS_PATHS = ['/leaders?pick=1', '/students'];");
  });

  it('Bus screens never use the pick list', () => {
    const bus = html.slice(html.indexOf('/* ── BUS MODULE ── */'));
    expect(bus.length).toBeGreaterThan(1000);
    expect(bus).not.toContain('pick=1');
  });

  it('"Who are you?" lists only leaders on this login\'s bracket and gender', () => {
    const prelude = `
      var S = { user: null };
      var LINK = { ldrs: null };
      function _juniorMin() { return 6; }
      function esc(x) { return String(x); }
      ${extractFn(html, 'quadGrades')}
      ${extractFn(html, 'quadGender')}
      ${extractFn(html, 'userGrades')}`;
    const f = loadFns(['_leaderPickable', '_lkIamListHtml'], prelude + '\nvar setUser = (u) => { S.user = u; };', ['_lkIamListHtml', 'setUser']);
    const ls = [
      { id: 'jg', fullName: 'Junior Girl', gender: 'female', grades: [8], active: true },
      { id: 'sg', fullName: 'Senior Girl', gender: 'female', grades: [11], active: true },
      { id: 'ng', fullName: 'No Gender', gender: null, grades: [8], active: true },
      { id: 'eg', fullName: 'No Grades', gender: 'female', grades: [], active: true },
      { id: 'jb', fullName: 'Junior Boy', gender: 'male', grades: [8], active: true },
    ];
    f.setUser({ role: 'quad', quad: 'g79' });
    const out = f._lkIamListHtml('', ls);
    expect(out).toContain('Junior Girl');
    for (const n of ['Senior Girl', 'No Gender', 'No Grades', 'Junior Boy']) expect(out).not.toContain(n);
    f.setUser({ role: 'admin' });
    expect(f._lkIamListHtml('', ls)).toContain('No Gender');
  });
});
