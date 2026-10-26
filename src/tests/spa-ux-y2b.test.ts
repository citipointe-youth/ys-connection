// UX batch 2026-10-12, lane Y2b (T10 modules draft, T11 DOB, T12 tab-strip scroll, T13 grade 6 juniors).
// Extract-and-run: the REAL functions from public/index.html against small stubs.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();

describe('T11 date of birth: DD/MM/YYYY typed, YYYY-MM-DD sent', () => {
  const f = loadFns(['_nyDobMask', '_nyDobIso', '_nyDobShow', '_nyDobError', '_nyDobProblem']);
  it('inserts the slashes as digits are typed', () => {
    expect(f._nyDobMask('15032011')).toBe('15/03/2011');
    expect(f._nyDobMask('1')).toBe('1');
    expect(f._nyDobMask('15')).toBe('15'); // no trailing slash yet, so backspace has nothing to fight
    expect(f._nyDobMask('150')).toBe('15/0');
    expect(f._nyDobMask('15/03/2011')).toBe('15/03/2011'); // pasted with slashes
    expect(f._nyDobMask('15/03/20111234')).toBe('15/03/2011'); // capped at 8 digits
    expect(f._nyDobMask('ab1c5')).toBe('15');
  });
  it('backspace works naturally: deleting the last character re-masks to the shorter value', () => {
    let v = f._nyDobMask('15032011');
    const seen: string[] = [];
    while (v) { v = f._nyDobMask(v.slice(0, -1)); seen.push(v); }
    expect(seen).toEqual(['15/03/201', '15/03/20', '15/03/2', '15/03', '15/0', '15', '1', '']);
  });
  it('the value sent is the same YYYY-MM-DD the date picker sent', () => {
    expect(f._nyDobIso('15/03/2011')).toBe('2011-03-15');
    expect(f._nyDobShow('2011-03-15')).toBe('15/03/2011');
    expect(f._nyDobShow('')).toBe('');
    expect(f._nyDobShow(undefined)).toBe('');
  });
  it('impossible dates are not dates', () => {
    for (const bad of ['31/02/2011', '00/05/2011', '15/13/2011', '29/02/2011', '15/03/1800', '1/3/2011', '15032011', '']) expect(f._nyDobIso(bad), bad).toBeNull();
    expect(f._nyDobIso('29/02/2012')).toBe('2012-02-29'); // a real leap day
  });
  it('inline error: empty or still typing is quiet; impossible and future dates speak', () => {
    const today = '2026-10-12';
    expect(f._nyDobError('', today)).toBe('');
    expect(f._nyDobError('15/03/20', today)).toBe('');
    expect(f._nyDobError('15/03/2011', today)).toBe('');
    expect(f._nyDobError('31/02/2011', today)).toMatch(/does not exist/);
    expect(f._nyDobError('13/10/2026', today)).toMatch(/future/);
    expect(f._nyDobError('12/10/2026', today)).toBe(''); // today is not the future
  });
  it('a send is stopped for a half-typed date but not for an empty one (that has its own message)', () => {
    const today = '2026-10-12';
    expect(f._nyDobProblem('', today)).toBe('');
    expect(f._nyDobProblem('15/03/20', today)).toMatch(/DD\/MM\/YYYY/);
    expect(f._nyDobProblem('31/02/2011', today)).toMatch(/does not exist/);
    expect(f._nyDobProblem('15/03/2011', today)).toBe('');
  });
  it('the form uses a numeric text input, and _nyRead sends the ISO value', () => {
    const form = extractFn(html, 'renderNewYouth');
    expect(form).toContain('id="ny-dob"');
    expect(form).toContain('inputmode="numeric"');
    expect(form).toContain('oninput="_nyDobInput(this)"');
    expect(form).not.toContain("'type=\"date\"'");
    expect(extractFn(html, '_nyRead')).toContain("dob: _nyDobIso(g('dob')) || ''");
  });
});

describe('T12 the tab strip keeps its scroll across a same-page re-render', () => {
  // A tiny stand-in for <main> that replaces its strip on innerHTML, like the browser does.
  const make = (opts: { samePage: boolean; scrollLeft: number; hasBar?: boolean }) => {
    const mkBar = (x: number) => ({ scrollLeft: x });
    let bar: any = opts.hasBar === false ? null : mkBar(opts.scrollLeft);
    const main = {
      querySelector: (q: string) => (q === '.tbbar' ? bar : null),
      set innerHTML(_h: string) { bar = mkBar(0); }, // a fresh strip starts at the left
    };
    const pre = `let _shellReady = true; let _lastRenderedPage = ${JSON.stringify(opts.samePage ? 'admin' : 'home')};
      const S = { page: 'admin' };
      const window = { scrollY: 40, scrollTo() {} };
      const document = { getElementById: () => __main };
      function _updateNavActive() {}`;
    const fns = new Function('__main', `${pre}\n${extractFn(html, 'setApp')}\nreturn { setApp };`)(main);
    return { fns, bar: () => bar };
  };
  it('restores the offset after the re-render (admin tab tapped far along the strip)', () => {
    const t = make({ samePage: true, scrollLeft: 230 });
    t.fns.setApp('<div class="tbbar"></div>');
    expect(t.bar().scrollLeft).toBe(230);
  });
  it('a different page starts at the left', () => {
    const t = make({ samePage: false, scrollLeft: 230 });
    t.fns.setApp('<div class="tbbar"></div>');
    expect(t.bar().scrollLeft).toBe(0);
  });
  it('a page without a strip is fine', () => {
    const t = make({ samePage: true, scrollLeft: 0, hasBar: false });
    expect(() => t.fns.setApp('<p>x</p>')).not.toThrow();
  });
});

describe('T13 grade 6 is a junior year when the ministry has it', () => {
  const load = (gradeMin?: number) => loadFns(['_structure', '_juniorMin', 'quadGrades', 'computeQuad', '_hQuadGrades'],
    `const S = { settings: { ministryConfig: { structure: ${JSON.stringify(gradeMin == null ? {} : { gradeMin })} } } };`);
  it('default (gradeMin 7): juniors are 7-9', () => {
    const f = load(7);
    expect(f.quadGrades('g79')).toEqual([7, 8, 9]);
    expect(f.quadGrades('b79')).toEqual([7, 8, 9]);
    expect(f._hQuadGrades('b79')).toEqual([7, 8, 9]);
    expect(f.computeQuad(6, 'female')).toBeNull();
    expect(f.computeQuad(7, 'female')).toBe('g79');
  });
  it('unset structure behaves as 7', () => {
    expect(load().quadGrades('g79')).toEqual([7, 8, 9]);
  });
  it('gradeMin 6: juniors are 6-9, seniors unchanged', () => {
    const f = load(6);
    expect(f.quadGrades('g79')).toEqual([6, 7, 8, 9]);
    expect(f.quadGrades('b79')).toEqual([6, 7, 8, 9]);
    expect(f._hQuadGrades('g79')).toEqual([6, 7, 8, 9]);
    expect(f.quadGrades('g1012')).toEqual([10, 11, 12]);
    expect(f.quadGrades('nope')).toEqual([]);
    expect(f.computeQuad(6, 'female')).toBe('g79');
    expect(f.computeQuad(6, 'male')).toBe('b79');
    expect(f.computeQuad(5, 'male')).toBeNull();
  });
  it('the quad label is Junior Girls with or without grade 6 (impeccable 2026-10-24 unified the quad names)', () => {
    const lab = (gradeMin: number) => loadFns(['_structure', '_juniorMin', '_simpleLoginsOn', 'quadLabel'],
      `const QUAD_LABELS = { g79:'Girls Yr 7–9' }; const SIMPLE_QUAD_LABELS = { g79:'Junior Girls' };
       const S = { settings: { ministryConfig: { structure: { gradeMin: ${gradeMin} }, logins: { simple: false } } } };`).quadLabel('g79');
    expect(lab(7)).toBe('Junior Girls');
    expect(lab(6)).toBe('Junior Girls');
  });
  it('no hard-coded junior 7-9 list is left', () => {
    expect(html).not.toMatch(/\[7, ?8, ?9\]:\s*\[10|\?\s*\[7,8,9\]\s*:/);
  });
  it('Simple logins have no Grade 6 lock', () => {
    const f = loadFns(['_setupLocks']);
    expect(f._setupLocks({ simpleOn: false, includeGrade6: true, cohort: 'grades-quads', quadOn: true })).toEqual({ simple: '' });
    expect(html).not.toMatch(/Years 7 to 12 only|locks\.grade6/);
  });
});

describe('T10 Youth Setup modules: the draft keeps all four switches', () => {
  const load = (modules: any) => {
    const f = loadFns(['_setupModuleMode', '_setupSetModule', '_setupElvantoModulesHtml', '_nyModeOf'],
      `const _SETUP_ELVANTO = ${html.match(/const _SETUP_ELVANTO = (\[[\s\S]*?\n\]);/)![1]};
       const _SETUP_SWITCHES = ${html.match(/const _SETUP_SWITCHES = (\[[\s\S]*?\n\]);/)![1]};
       let _setupDraft = { modules: ${JSON.stringify(modules)} };
       function _setupRerender() {}
       function helpTip(t) { return '<tip>' + t + '</tip>'; }
       function esc(s) { return String(s); }`, ['_setupModuleMode', '_setupSetModule', '_setupElvantoModulesHtml']);
    return { f };
  };
  it('missing keys read as the stored New person value', () => {
    const { f } = load({ newYouthForms: 'admin' });
    for (const k of ['checkin', 'lifegroupReport', 'flows']) expect(f._setupModuleMode({ newYouthForms: 'admin' }, k)).toBe('admin');
    expect(f._setupModuleMode({ newYouthForms: 'on', flows: 'off' }, 'flows')).toBe('off');
    expect(f._setupModuleMode({}, 'checkin')).toBe('off');
  });
  it('shows four selects with plain labels, admin marked Admin only', () => {
    const { f } = load({});
    const out = f._setupElvantoModulesHtml({ newYouthForms: 'admin' });
    for (const label of ['New person', 'Check-in', 'Lifegroup report', 'Flow steps']) expect(out).toContain(label);
    expect(out.match(/<select/g)).toHaveLength(4);
    expect(out.match(/selected/g)).toHaveLength(4); // each shows the inherited admin
    expect(out).toContain('Admin only');
    // Modular setup: the four switchboard keys are checkboxes, on unless stored false.
    for (const label of ['Live Elvanto link', 'Public consent form', 'Digest email', 'Camp']) expect(out).toContain(label);
    expect(out.match(/type="checkbox" id="setup-\w+" checked/g)).toHaveLength(4);
    expect(f._setupElvantoModulesHtml({ camp: false })).not.toMatch(/id="setup-camp" checked/);
  });
  it('changing one writes all four, so the others do not move by inheritance', () => {
    const body = `${extractFn(html, '_setupSetModule')}\n${extractFn(html, '_setupModuleMode')}\n${extractFn(html, '_nyModeOf')}`;
    const run = (md: any, key: string, val: string) => new Function(`
      const _SETUP_ELVANTO = ${html.match(/const _SETUP_ELVANTO = (\[[\s\S]*?\n\]);/)![1]};
      let _setupDraft = { modules: ${JSON.stringify(md)} }; function _setupRerender() {}
      ${body}
      _setupSetModule(${JSON.stringify(key)}, ${JSON.stringify(val)}); return _setupDraft.modules;`)();
    expect(run({ newYouthForms: 'admin' }, 'newYouthForms', 'on')).toMatchObject({ newYouthForms: 'on', checkin: 'admin', lifegroupReport: 'admin', flows: 'admin' });
    expect(run({ newYouthForms: 'on' }, 'flows', 'off')).toMatchObject({ newYouthForms: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'off' });
  });
  // Y4 (SPEC Y4) supersedes T10 here: the settings file never carries the four Elvanto switches (settings-file.spa.test.ts).
  it('the settings file download leaves the four values out', () => {
    const fn = extractFn(html, 'exportSettingsFile');
    expect(fn).not.toContain('_setupModuleMode(cfg.modules, k)');
    expect(fn).toContain('_dropLocationKeys(cfg)');
  });
});
