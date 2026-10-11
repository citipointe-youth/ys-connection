import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

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
