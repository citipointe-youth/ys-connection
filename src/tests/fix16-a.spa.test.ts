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

  it('"Who are you?" lists only the server pick list, and fails closed while loading or on error', async () => {
    const prelude = `
      var S = { user: null };
      var LINK = { ldrs: null };
      var gets = [], paints = [];
      var next = null;
      var API = { get: (p) => { gets.push(p); return next; } };
      function esc(x) { return String(x); }
      function _lkIamFilter(v) { paints.push(v); }
      var set = (u, pick) => { S.user = u; LINK.iamPick = pick; };
      var setNext = (p) => { next = p; };
      var pick = () => LINK.iamPick;`;
    const f = loadFns(['_lkIamListHtml'], prelude, ['_lkIamListHtml', 'set', 'setNext', 'gets', 'paints', 'pick']);
    const ls = [
      { id: 'jg', fullName: 'Junior Girl', active: true },
      { id: 'sg', fullName: 'Senior Girl', active: true },
      { id: 'ng', fullName: 'No Gender', active: true },
    ];
    // quad, not loaded: asks the server once and lists NOBODY until it answers
    let resolve: (v: any) => void = () => {};
    f.setNext(new Promise((r) => { resolve = r; }));
    f.set({ role: 'quad', quad: 'g79' }, undefined);
    const loading = f._lkIamListHtml('jun', ls);
    expect(f.gets).toEqual(['/leaders?pick=1']);
    expect(loading).toContain('Loading names');
    for (const n of ['Junior Girl', 'Senior Girl', 'No Gender']) expect(loading).not.toContain(n);
    expect(f._lkIamListHtml('', ls)).toContain('Loading names'); // still loading: no second request
    expect(f.gets.length).toBe(1);
    resolve([{ id: 'jg' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(f.paints).toEqual(['']); // repaints with the last typed text
    const out = f._lkIamListHtml('', ls);
    expect(out).toContain('Junior Girl');
    expect(out).not.toContain('Senior Girl');
    expect(out).not.toContain('No Gender');
    // request failure: an error with a retry, never the unfiltered list
    f.setNext(Promise.reject(new Error('down')));
    f.set({ role: 'grade', grades: [8] }, undefined);
    f._lkIamListHtml('', ls);
    await new Promise((r) => setTimeout(r, 0));
    const err = f._lkIamListHtml('', ls);
    expect(err).toContain("Couldn't load the names");
    expect(err).toContain('_lkIamRetry()');
    for (const n of ['Junior Girl', 'Senior Girl', 'No Gender']) expect(err).not.toContain(n);
    // admin: never filtered, never fetches
    const before = f.gets.length;
    f.set({ role: 'admin' }, undefined);
    expect(f._lkIamListHtml('', ls)).toContain('No Gender');
    expect(f.gets.length).toBe(before);
  });

  it('Home Follow Up: a 403 for a saved out-of-scope "I am" clears it and shows the picker', async () => {
    const prelude = `
      var S = { user: { role: 'quad', quad: 'g79' } };
      var mine = 'out', cleared = [];
      var host = { innerHTML: '' };
      var document = { getElementById: (id) => (id === 'home-followup' ? host : null) };
      function _lkHomeFlows() {}
      function getMyLeaderId() { return mine; }
      function setMyLeaderId(v) { cleared.push(v); mine = v; }
      function esc(x) { return String(x); }
      function helpTip() { return ''; }
      var Cache = { getStale: () => null };
      var API = { get: (p) => p.indexOf('/followup') >= 0
        ? Promise.reject(Object.assign(new Error('no'), { status: 403 }))
        : Promise.resolve([{ id: 'jg', fullName: 'Junior Girl' }]) };
      var out = () => host.innerHTML;`;
    const f = loadFns(['renderHomeFollowup'], prelude, ['renderHomeFollowup', 'out', 'cleared']);
    await f.renderHomeFollowup();
    expect(f.cleared).toEqual([null]);
    expect(f.out()).toContain('Choose your name');
    expect(f.out()).toContain('Junior Girl');
  });
});
