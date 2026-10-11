import { describe, it, expect, vi } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const QL = `const QUAD_LABELS = { g79:'Girls Yr 7–9', b79:'Boys Yr 7–9', g1012:'Girls Yr 10–12', b1012:'Boys Yr 10–12' };
const SIMPLE_QUAD_LABELS = { g79:'Junior Girls', b79:'Junior Guys', g1012:'Senior Girls', b1012:'Senior Guys' };`;

describe('S1.1 quadLabel and _simpleLoginsOn', () => {
  it('_simpleLoginsOn is false with an empty config', () => {
    const f = loadFns(['_simpleLoginsOn'], `const S = { settings: { ministryConfig: {} } };`);
    expect(f._simpleLoginsOn()).toBe(false);
  });
  it('quadLabel uses the old label when Simple is off', () => {
    const f = loadFns(['_simpleLoginsOn', 'quadLabel'], `${QL} const S = { settings: { ministryConfig: { logins: { simple: false } } } };`);
    expect(f.quadLabel('b1012')).toBe('Boys Yr 10–12');
  });
  it('quadLabel uses Senior Guys when Simple is on', () => {
    const f = loadFns(['_simpleLoginsOn', 'quadLabel'], `${QL} const S = { settings: { ministryConfig: { logins: { simple: true } } } };`);
    expect(f.quadLabel('b1012')).toBe('Senior Guys');
    expect(f.quadLabel('g79')).toBe('Junior Girls');
  });
  it('client defaults mirror logins.simple only, and modules.prayers', () => {
    const src = loadIndexHtml();
    const i = src.indexOf('const MINISTRY_CONFIG_DEFAULTS_CLIENT = {');
    const block = src.slice(i, src.indexOf('\n};', i));
    expect(block).toMatch(/logins: \{ simple: false \}/);
    expect(block).toMatch(/prayers: true/);
    expect(block).not.toMatch(/retiredGradeIds|gradeRoleWasOn/);
  });
  it('no hard-coded quad label maps remain outside QUAD_LABELS', () => {
    const src = loadIndexHtml();
    expect(src).not.toMatch(/QUAD_LABELS_LOCAL/);
    expect(src).not.toMatch(/QLBL\[/);
  });
});

describe('S1.2 Youth Setup', () => {
  const DEFAULTS = `const MINISTRY_CONFIG_DEFAULTS_CLIENT = { modules: { connectionAudit: true, prayers: true }, logins: { simple: false }, roles: { enabled: { grade: true } } };
const PRESET_CONFIGS_CLIENT = { simple: { structure: { cohortModel: 'none' }, modules: { connectionAudit: false } } };
const PRESET_SERVICE_MIN_ATTENDANCE_CLIENT = { simple: 10 };
let _setupServiceMinAttendance = 100; function _setupRerender() {}`;

  it('pickMinistryPreset keeps the draft logins and modules.prayers', () => {
    const f = loadFns(['_deepMergeClient', 'pickMinistryPreset'],
      `${DEFAULTS} let _setupDraft = { logins: { simple: true }, modules: { prayers: false } }; function __d() { return _setupDraft; }`,
      ['pickMinistryPreset', '__d']);
    f.pickMinistryPreset('simple');
    const d = f.__d();
    expect(d.logins.simple).toBe(true);
    expect(d.modules.prayers).toBe(false);
    expect(d.modules.connectionAudit).toBe(false);
    expect(d.structure.cohortModel).toBe('none');
  });

  it('_setupRiskyDiff reports only logins.simple and modules.prayers changes', () => {
    const { _setupRiskyDiff } = loadFns(['_setupRiskyDiff']);
    expect(_setupRiskyDiff({}, {})).toEqual([]);
    expect(_setupRiskyDiff({}, { logins: { simple: false }, modules: { prayers: true }, branding: { appName: 'X' } })).toEqual([]);
    expect(_setupRiskyDiff({}, { logins: { simple: true } })).toEqual(['logins.simple']);
    expect(_setupRiskyDiff({ logins: { simple: true } }, { logins: { simple: true }, modules: { prayers: false } })).toEqual(['modules.prayers']);
    expect(_setupRiskyDiff({ logins: { simple: true } }, { modules: { prayers: false } })).toEqual(['logins.simple', 'modules.prayers']);
  });

  it('exportSettingsFile carries logins.simple, never the server-owned fields', () => {
    const f = loadFns(['_stripServerOwnedLogins', 'exportSettingsFile'],
      `let _setupDraft = { logins: { simple: true, retiredGradeIds: ['u1'], gradeRoleWasOn: true }, busMinistry: {} };
       let _setupServiceMinAttendance = 100, _setupTermGapDays = 14, __out = null;
       function _downloadText(n, t) { __out = t; } function __o() { return JSON.parse(__out); }`,
      ['exportSettingsFile', '__o']);
    f.exportSettingsFile();
    expect(f.__o().ministryConfig.logins).toEqual({ simple: true });
  });

  it('_parseSettingsFile carries logins.simple, never the server-owned fields', () => {
    const f = loadFns(['_stripServerOwnedLogins', '_parseSettingsFile'], '', ['_parseSettingsFile']);
    const r = f._parseSettingsFile(JSON.stringify({ kind: 'ys-connection-settings', version: 1, ministryConfig: { logins: { simple: true, retiredGradeIds: ['x'], gradeRoleWasOn: false } } }));
    expect(r.ministryConfig.logins).toEqual({ simple: true });
  });

  it('buildTargetAccountsClient with Complex + Simple on gives the 4 quads only, with Simple names', () => {
    const f = loadFns(['_gradeBracketsClient', '_gradeWordLabelClient', 'buildTargetAccountsClient'], QL, ['buildTargetAccountsClient']);
    const out = f.buildTargetAccountsClient('grades-quads', 7, 12, 'Grade', true);
    expect(out).toEqual([
      { role: 'quad', username: 'g79', displayName: 'Junior Girls' },
      { role: 'quad', username: 'b79', displayName: 'Junior Guys' },
      { role: 'quad', username: 'g1012', displayName: 'Senior Girls' },
      { role: 'quad', username: 'b1012', displayName: 'Senior Guys' },
    ]);
    const off = f.buildTargetAccountsClient('grades-quads', 7, 12, 'Grade', false);
    expect(off.filter((t: any) => t.role === 'grade')).toHaveLength(12);
  });

  it('saveMinistrySetup clears _setupDraft and toasts the renamed count', async () => {
    const f = loadFns(['saveMinistrySetup'],
      `let _setupDraft = { logins: { simple: true } }, _setupServiceMinAttendance = 100, _setupTermGapDays = 14;
       const toasts = []; function toast(m) { toasts.push(m); }
       const S = {}; let _shellReady = false; function _navSig() { return ''; } function _initShell() {} function applyTheme() {}
       const Cache = { del() {} }; let _adminData = { users: [], history: [] };
       const API = { patch: async () => ({ ministryConfig: { logins: { simple: true } }, renamedQuads: 4 }), get: async () => ({}) };
       let __drafts = []; async function renderAdminView() { __drafts.push(_setupDraft); }
       function __d() { return __drafts; } function __t() { return toasts; } function __s() { return S; }`,
      ['saveMinistrySetup', '__d', '__t', '__s']);
    await f.saveMinistrySetup();
    expect(f.__d()).toEqual([null]);
    expect(f.__t().join(' ')).toMatch(/Renamed 4 quad logins/);
    expect(f.__s().settings.renamedQuads).toBeUndefined();
  });
});

describe('S1.3 grade filter core', () => {
  const VG = ['_vgActive', '_vgLeader', '_vgGrades', '_vgSet', '_vgToggle', '_vgAll', '_vgMine', '_vgSave', '_vgReset', '_vgBar'];
  const prelude = (opts: { me?: string | null; role?: string; leaders?: any[]; preview?: boolean; simple?: boolean }) => `
    ${QL}
    const S = { user: { role: ${JSON.stringify(opts.role ?? 'quad')}, quad: 'b79' }, settings: { ministryConfig: { logins: { simple: ${opts.simple ?? true} }, structure: {} } } };
    function _simpleLoginsOn() { return !!S.settings.ministryConfig.logins.simple; }
    function getMyLeaderId() { return ${JSON.stringify(opts.me ?? null)}; }
    function quadGrades(q) { return (q === 'g79' || q === 'b79') ? [7, 8, 9] : [10, 11, 12]; }
    function _gradeWord() { return 'Year'; }
    function esc(s) { return String(s); }
    const __leaders = ${JSON.stringify(opts.leaders ?? [])};
    const Cache = { getStale(k) { return k === '/leaders' ? __leaders : null; } };
    let _previewStash = ${opts.preview ? '{ token: 1 }' : 'null'};
    const __patches = []; const API = { patch: async (p, b) => { __patches.push([p, b]); return {}; } };
    let __renders = 0; function render() { __renders++; }
    let _vgLocal = {}, _vgTimer = null;
    function toast() {}
    function __p() { return __patches; }
  `;
  const load = (o: Parameters<typeof prelude>[0]) => loadFns(VG, prelude(o), [...VG, '__p']);

  it('no I am pick: null (whole bracket) and the hint', () => {
    const f = load({ me: null });
    expect(f._vgGrades()).toBeNull();
    expect(f._vgBar()).toContain('Pick who you are on Home to filter by your grades');
  });
  it('non-quad login: null and no bar', () => {
    const f = load({ me: 'L1', role: 'director', leaders: [{ id: 'L1', grades: [8] }] });
    expect(f._vgGrades()).toBeNull();
    expect(f._vgBar()).toBe('');
  });
  it('Simple off: null', () => {
    const f = load({ me: 'L1', simple: false, leaders: [{ id: 'L1', grades: [8] }] });
    expect(f._vgGrades()).toBeNull();
  });
  it('no saved filter: leader.grades within the bracket', () => {
    const f = load({ me: 'L1', leaders: [{ id: 'L1', grades: [8, 9, 10] }] });
    expect(f._vgGrades()).toEqual([8, 9]);
  });
  it('saved viewGrades win, clamped to the bracket', () => {
    const f = load({ me: 'L1', leaders: [{ id: 'L1', grades: [8], viewGrades: [7, 12] }] });
    expect(f._vgGrades()).toEqual([7]);
  });
  it('out-of-bracket only falls back to the whole bracket', () => {
    const f = load({ me: 'L1', leaders: [{ id: 'L1', grades: [11] }] });
    expect(f._vgGrades()).toEqual([7, 8, 9]);
  });
  it('All saves the full bracket, My grades saves null (debounced 600 ms)', async () => {
    vi.useFakeTimers();
    try {
      const f = load({ me: 'L1', leaders: [{ id: 'L1', grades: [8] }] });
      f._vgAll();
      expect(f._vgGrades()).toEqual([7, 8, 9]);
      await vi.advanceTimersByTimeAsync(600);
      expect(f.__p()).toEqual([['/leaders/L1/view-grades', { grades: [7, 8, 9] }]]);
      f._vgMine();
      await vi.advanceTimersByTimeAsync(600);
      expect(f.__p()[1]).toEqual(['/leaders/L1/view-grades', { grades: null }]);
      expect(f._vgGrades()).toEqual([8]);
    } finally { vi.useRealTimers(); }
  });
  it('unticking the last chip does nothing', async () => {
    vi.useFakeTimers();
    try {
      const f = load({ me: 'L1', leaders: [{ id: 'L1', grades: [8] }] });
      f._vgToggle(8);
      expect(f._vgGrades()).toEqual([8]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.__p()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('three taps inside 600 ms save once', async () => {
    vi.useFakeTimers();
    try {
      const f = load({ me: 'L1', leaders: [{ id: 'L1', grades: [8] }] });
      f._vgToggle(7); f._vgToggle(9); f._vgToggle(8);
      await vi.advanceTimersByTimeAsync(599);
      expect(f.__p()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.__p()).toEqual([['/leaders/L1/view-grades', { grades: [7, 9] }]]);
    } finally { vi.useRealTimers(); }
  });
  it('a save updates the /leaders cache entry in place', async () => {
    vi.useFakeTimers();
    try {
      const leaders = [{ id: 'L1', grades: [8] }];
      const f = load({ me: 'L1', leaders });
      f._vgToggle(9);
      await vi.advanceTimersByTimeAsync(600);
      f._vgReset();
      expect(f._vgGrades()).toEqual([8, 9]);
    } finally { vi.useRealTimers(); }
  });
  it('in account preview taps change the in-memory filter but never call the API', async () => {
    vi.useFakeTimers();
    try {
      const f = load({ me: 'L1', preview: true, leaders: [{ id: 'L1', grades: [8] }] });
      f._vgToggle(9); f._vgAll(); f._vgMine(); f._vgToggle(7);
      expect(f._vgGrades()).toEqual([7, 8]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.__p()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('enterPreview and exitPreview both clear yap_leader_id', async () => {
    const src = loadIndexHtml();

    for (const n of ['enterPreview', 'exitPreview']) expect(extractFn(src, n)).toMatch(/setMyLeaderId\(null\)/);
    const store: Record<string, string> = { yap_leader_id: 'L1' };
    (globalThis as any).__store = store;
    const f = loadFns(['setMyLeaderId', 'exitPreview'], `
      const localStorage = { setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
      const store = globalThis.__store; let _previewStash = { token: 't', user: {} };
      const API = { setToken() {} }; const S = {}; const Cache = { clear() {} }; let _shellReady = true;
      function go() {} function _vgReset() {}`, ['exitPreview']);
    f.exitPreview();
    expect(store.yap_leader_id).toBeUndefined();
  });
  it('doLogout leaves the view grades alone (they live on the server)', () => {

    const body = extractFn(loadIndexHtml(), 'doLogout');
    expect(body).not.toMatch(/view-grades|viewGrades|_vg/);
  });
});
