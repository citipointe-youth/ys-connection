import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';
import { MinistryConfigSchema } from '../core/ministry-config';
import { stepHidden } from '../services/link.service';
import { makeSettingsService } from '../services/settings.service';
import { makeSetupService } from '../services/setup.service';
import { InMemorySettingsRepository, InMemoryAuditRepository, InMemoryUserRepository } from '../repositories/in-memory';
import type { Actor, User } from '../core/entities/user';
import type { AuthService } from '../services/auth.service';
import { LATEST_MIGRATION } from '../core/schema-version';

// Settings clean-up 2026-10-27 (operator rulings): Login style, Notices checkbox, hidden steps as a list. Fictional data only.
const actor = (role: string) => ({ id: 'x', role, displayName: 'T', grade: null, quad: null }) as unknown as Actor;
const ADMIN = actor('admin');
const QUAD = actor('quad');
const row = (stepId: string, stepOrder: number) => ({ flowId: 'F1', stepId, stepOrder });

describe('hidden steps: a list per flow, old strings read as before', () => {
  const parse = (v: unknown) => MinistryConfigSchema.parse({ modules: { flowHiddenStep: v } }).modules.flowHiddenStep;
  it('old stored strings parse to the same meaning', () => {
    expect(parse({ F1: 'none', F2: 's2', F3: '' })).toEqual({ F1: [], F2: ['s2'] });
    expect(parse({ F1: ['a', 'b'] })).toEqual({ F1: ['a', 'b'] });
    expect(parse(undefined)).toEqual({});
    expect(() => parse({ F1: 5 })).toThrow();
  });
  it('stepHidden: missing = first step, a list = exactly those steps, old strings still work', () => {
    expect(stepHidden(QUAD, row('s1', 1), {})).toBe(true);
    expect(stepHidden(QUAD, row('s2', 2), {})).toBe(false);
    expect(stepHidden(QUAD, row('s1', 1), { F1: [] })).toBe(false);
    expect(stepHidden(QUAD, row('s2', 2), { F1: ['s2', 's3'] })).toBe(true);
    expect(stepHidden(QUAD, row('s1', 1), { F1: ['s2', 's3'] })).toBe(false);
    expect(stepHidden(QUAD, row('s1', 1), { F1: 'none' } as never)).toBe(false);
    expect(stepHidden(QUAD, row('s2', 2), { F1: 's2' } as never)).toBe(true);
    expect(stepHidden(ADMIN, row('s1', 1), {})).toBe(false);
  });
  it("ruling B: a location-wide '*' list applies to a flow with no saved list of its own", () => {
    expect(stepHidden(QUAD, row('s1', 1), { '*': [] })).toBe(false);
    expect(stepHidden(QUAD, row('s1', 1), { '*': [], F1: ['s1'] })).toBe(true);
  });
  it('a new install saves an empty list for every flow (nothing hidden)', async () => {
    const settings = new InMemorySettingsRepository();
    const auth = { issueTokenFor: async (id: string) => `t-${id}` } as unknown as AuthService;
    const env = { PERSISTENCE: 'supabase', DATABASE_URL: 'postgresql://u:p@h.example.com:5432/postgres', SESSION_SECRET: 's'.repeat(64),
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), APP_ORIGIN: 'https://church.vercel.app', SETUP_CODE: 'ABCD-EFGH-JKMN-PQRS-TUVW' };
    const s = makeSetupService({ users: new InMemoryUserRepository(), auth, env, settings, probeDb: async () => true, schemaVersion: async () => LATEST_MIGRATION });
    await s.createFirstAdmin({ code: env.SETUP_CODE, displayName: 'A', password: 'longenough' });
    expect((await settings.getSettings()).ministryConfig.modules.flowHiddenStep).toEqual({ '*': [] });
  });
  it('SPA: the checklist reads the same rule and a tick writes the whole list for that flow', () => {
    const steps = [{ flowId: 'F1', stepId: 's1', stepOrder: 1 }, { flowId: 'F1', stepId: 's2', stepOrder: 2 }];
    const f = loadFns(['_flowHiddenList', '_setupFlowStepToggle'],
      `let _setupDraft = { modules: { flowHiddenStep: {} } }; let _setupFlowSteps = ${JSON.stringify(steps)}; function _setupRerender() {} function __d() { return _setupDraft; }`,
      ['_flowHiddenList', '_setupFlowStepToggle', '__d']);
    expect(f._flowHiddenList({}, 'F1', steps)).toEqual(['s1']);
    expect(f._flowHiddenList({ '*': [] }, 'F1', steps)).toEqual([]);
    expect(f._flowHiddenList({ F1: 'none' }, 'F1', steps)).toEqual([]);
    expect(f._flowHiddenList({ F1: 's2' }, 'F1', steps)).toEqual(['s2']);
    f._setupFlowStepToggle('F1', 's2', true);
    expect(f.__d().modules.flowHiddenStep).toEqual({ F1: ['s1', 's2'] });
    f._setupFlowStepToggle('F1', 's1', false);
    expect(f.__d().modules.flowHiddenStep).toEqual({ F1: ['s2'] });
  });
  it('SPA: each step is a checkbox, no dropdown', () => {
    const fn = extractFn(loadIndexHtml(), '_setupFlowHiddenHtml');
    expect(fn).toContain("Leaders can't see or tick this");
    expect(fn).toContain('type="checkbox"');
    expect(fn).not.toContain('<select');
  });
});

describe('Login style: one control for Junior/Senior or Director and leaders', () => {
  const BRISBANE = { structure: { cohortModel: 'grades-quads' }, logins: { simple: true }, modules: { notices: 'off' },
    roles: { enabled: { director: true, grade: false, quad: true, leader: false } } };
  const f = loadFns(['_loginStyleOf', '_applyLoginStyle', '_setupNoticesHtml'],
    'let _setupDraft = null; function _setupRerender() {} function helpTip(t) { return ""; } function __d() { return _setupDraft; }',
    ['_loginStyleOf', '_applyLoginStyle', '_setupNoticesHtml', '__d']);
  it("Brisbane's live state reads back as Junior/Senior; quad off reads as Director and leaders", () => {
    expect(f._loginStyleOf(BRISBANE)).toBe('junior-senior');
    expect(f._loginStyleOf({})).toBe('junior-senior');
    expect(f._loginStyleOf({ roles: { enabled: { quad: false } } })).toBe('director-leaders');
  });
  it('Director and leaders writes the stored fields and turns Notices off; Junior/Senior never turns Notices on', () => {
    const dl = f._applyLoginStyle(JSON.parse(JSON.stringify(BRISBANE)), 'director-leaders');
    expect(dl).toMatchObject({ structure: { cohortModel: 'none' }, logins: { simple: true }, modules: { notices: 'off' },
      roles: { enabled: { director: true, grade: false, quad: false, leader: true } } });
    const js = f._applyLoginStyle(JSON.parse(JSON.stringify(dl)), 'junior-senior');
    expect(js).toMatchObject({ structure: { cohortModel: 'grades-quads' }, logins: { simple: true }, modules: { notices: 'off' },
      roles: { enabled: { director: true, grade: false, quad: true } } });
    expect(f._applyLoginStyle(JSON.parse(JSON.stringify(BRISBANE)), 'junior-senior')).toEqual({ ...BRISBANE });
  });
  it('Notices is a checkbox, offered only for Junior/Senior', () => {
    expect(f._setupNoticesHtml({ notices: 'on' }, 'junior-senior')).toMatch(/type="checkbox" id="setup-notices" checked/);
    expect(f._setupNoticesHtml({}, 'junior-senior')).toMatch(/id="setup-notices"  onchange/);
    expect(f._setupNoticesHtml({ notices: 'on' }, 'director-leaders')).toBe('');
  });
  it('the old controls are gone from Youth Setup', () => {
    const body = extractFn(loadIndexHtml(), '_youthSetupBody');
    for (const gone of ['fl-cohort-model', 'Start from', 'Apply account layout', 'fl-consent-closes-at', "'logins.simple'", "['quad', 'Quad'", "['grade', 'Grade'", 'Complex'])
      expect(body).not.toContain(gone);
    expect(body).toContain('fl-login-style');
    expect(body).toContain("' 6 counts as a junior year.");
  });
});

describe('Login style on the server', () => {
  async function svc() {
    const repo = new InMemorySettingsRepository();
    const users = new InMemoryUserRepository();
    const audit = new InMemoryAuditRepository();
    await Promise.all([repo.init(), users.init(), audit.init()]);
    const service = makeSettingsService(repo, audit, users);
    await service.update(ADMIN, { ministryConfig: { logins: { simple: true } } });
    await users.save({ id: 'g7', displayName: 'G7', email: 'g7', role: 'grade', grade: 7, quad: null, status: 'inactive',
      mustChangePassword: false, createdAt: 'x', updatedAt: 'x' } as User);
    return { service, repo, users };
  }
  it('Director and leaders saves with Junior/Senior logins kept on; the retired grade logins stay retired', async () => {
    const { service, repo, users } = await svc();
    await service.update(ADMIN, { ministryConfig: { structure: { cohortModel: 'none' }, roles: { enabled: { quad: false, leader: true } } } });
    const mc = (await repo.getSettings()).ministryConfig;
    expect(mc.structure.cohortModel).toBe('none');
    expect(mc.logins.simple).toBe(true);
    expect(mc.roles.enabled).toMatchObject({ grade: false, quad: false, leader: true });
    expect((await users.findById('g7'))!.status).toBe('inactive');
  });
  it('a half-and-half state is refused with the Login style words', async () => {
    const { service } = await svc();
    const MSG = 'Pick a Login style in Youth Setup: Junior/Senior, or Director and leaders.';
    await expect(service.update(ADMIN, { ministryConfig: { roles: { enabled: { quad: false } } } })).rejects.toThrow(MSG);
    await expect(service.update(ADMIN, { ministryConfig: { structure: { cohortModel: 'none' } } })).rejects.toThrow(MSG);
  });
});
