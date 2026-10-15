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
    const names = [...html.matchAll(/function ((?:_bus|renderBus|bus)\w*)\(/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(50);
    for (const n of new Set(names)) expect(extractFn(html, n), n).not.toContain('pick=1');
  });

  it('"Who are you?" lists only leaders on this login\'s bracket and gender', () => {
    const prelude = `
      var S = { user: null };
      var LINK = { ldrs: null };
      var gets = [];
      var API = { get: (p) => { gets.push(p); return new Promise(() => {}); } };
      function esc(x) { return String(x); }
      function _lkIamFilter() {}
      var set = (u, pick) => { S.user = u; LINK.iamPick = pick; };`;
    const f = loadFns(['_lkIamListHtml'], prelude, ['_lkIamListHtml', 'set', 'gets']);
    const ls = [
      { id: 'jg', fullName: 'Junior Girl', active: true },
      { id: 'sg', fullName: 'Senior Girl', active: true },
      { id: 'ng', fullName: 'No Gender', active: true },
    ];
    // quad: first call asks the server for its pick list
    f.set({ role: 'quad', quad: 'g79' }, undefined);
    f._lkIamListHtml('', ls);
    expect(f.gets).toEqual(['/leaders?pick=1']);
    // once loaded, only the server's in-scope ids are listed
    f.set({ role: 'quad', quad: 'g79' }, new Set(['jg']));
    const out = f._lkIamListHtml('', ls);
    expect(out).toContain('Junior Girl');
    expect(out).not.toContain('Senior Girl');
    expect(out).not.toContain('No Gender');
    // admin: never filtered, never fetches
    f.set({ role: 'admin' }, undefined);
    expect(f._lkIamListHtml('', ls)).toContain('No Gender');
    expect(f.gets.length).toBe(1);
  });
});
