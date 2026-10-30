// Modular setup Phase 1b (B1): new campuses are Junior/Senior only. One preset, no Complex/Simple "Start from" card or
// "Apply account layout" button on a configured install, and the deploy guide says Junior/Senior only.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryUserRepository, InMemorySettingsRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeSetupService } from '../services/setup.service';
import type { AuthService } from '../services/auth.service';
import { LATEST_MIGRATION } from '../core/schema-version';
import { planCohortAccountLayout } from '../services/cohort-account-layout';
import { MinistryConfigSchema, MINISTRY_PRESETS, PRESET_CONFIGS } from '../core/ministry-config';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import LIVE_MODULES from './fixtures/live-modules.json';

const env = { PERSISTENCE: 'supabase', DATABASE_URL: 'postgresql://u:p@h.example.com:5432/postgres', SESSION_SECRET: 's'.repeat(64),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), APP_ORIGIN: 'https://church.vercel.app', SETUP_CODE: 'ABCD-EFGH-JKMN-PQRS-TUVW' };

describe('JS1: a fresh install lays out the 4 Junior/Senior logins and no grade logins', () => {
  it('createFirstAdmin then the layout plan', async () => {
    const settings = new InMemorySettingsRepository();
    const users = new InMemoryUserRepository();
    const auth = { issueTokenFor: vi.fn(async (id: string) => `tok-${id}`) } as unknown as AuthService;
    const s = makeSetupService({ users, auth, env, settings, probeDb: async () => true, schemaVersion: async () => LATEST_MIGRATION });
    const { user } = await s.createFirstAdmin({ code: env.SETUP_CODE, displayName: 'A', password: 'longenough' });
    const cfg = (await settings.getSettings()).ministryConfig;
    const st = cfg.structure;
    const plan = planCohortAccountLayout(st.cohortModel, st.gradeMin, st.gradeMax, st.gradeLabel,
      [{ id: user.id, role: 'admin', email: 'admin', displayName: 'A', status: 'active' }] as never, cfg.logins.simple);
    expect(plan.toCreate.map((t) => t.displayName)).toEqual(['Junior Girls', 'Junior Guys', 'Senior Girls', 'Senior Guys']);
    expect(plan.toCreate.every((t) => t.role === 'quad')).toBe(true);
    expect(plan.toDeactivate).toEqual([]);
  });
});

describe('JS2: the deploy guide has no Complex', () => {
  it('docs/DEPLOYING.md', () => {
    const t = readFileSync(join(__dirname, '..', '..', 'docs', 'DEPLOYING.md'), 'utf8');
    expect(t).not.toMatch(/Complex/);
    expect(t).not.toMatch(/Simple Ministry/);
  });
});

describe('JS3: stored rows still parse; one preset', () => {
  it("a stored preset:'simple' row parses, and only large-graded-au has a config", () => {
    expect(MINISTRY_PRESETS).toContain('simple');
    expect(MinistryConfigSchema.parse({ preset: 'simple' }).preset).toBe('simple');
    expect(Object.keys(PRESET_CONFIGS)).toEqual(['large-graded-au']);
  });
});

describe('JS4 (2026-10-27): Youth Setup draws no Start-from row and no layout button; Login style reads the live state', () => {
  const HTML = loadIndexHtml();
  const fnsOf = ['_youthSetupBody', '_setupCard', '_loginStyleOf', '_setupNoticesHtml'];
  function body(users: unknown[], over: object = {}) {
    const cfg = MinistryConfigSchema.parse({ modules: LIVE_MODULES, logins: { simple: true }, ...over });
    const f = loadFns(fnsOf, `
      const S = { user: { role: 'admin' }, settings: { ministryConfig: ${JSON.stringify(cfg)} } };
      let _setupDraft = S.settings.ministryConfig; function _ensureSetupDraft() {} const _setupOpen = {}; const _setupFlowSteps = []; let _logoModeOverride = null; let _setupElv = null;
      let _setupServiceMinAttendance = 100, _setupTermGapDays = 14;
      const MINISTRY_CONFIG_DEFAULTS_CLIENT = ${JSON.stringify(MinistryConfigSchema.parse({}))};
      const _setupElvantoModulesHtml = () => '', _setupFlowHiddenHtml = () => '', _setupIntakeHtml = () => '', _setupElvCardHtml = () => '';
      const _DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const esc = (x) => String(x), L = (k) => k, icN = () => '', icS = () => '', helpTip = () => '', _serviceDayName = () => 'Friday', brandMark = () => '', userGrades = () => [];`, ['_youthSetupBody']);
    return f._youthSetupBody({ ministryConfig: cfg }, users) as string;
  }
  it('fresh or configured: neither the presets nor Apply account layout is drawn', () => {
    for (const users of [[{ role: 'admin' }], [{ role: 'admin' }, { role: 'quad' }]]) {
      const h = body(users);
      expect(h).not.toContain('pickMinistryPreset');
      expect(h).not.toContain('Start from');
      expect(h).not.toContain('Apply account layout');
      expect(h).not.toMatch(/Complex|Cohort model/);
    }
  });
  it("Brisbane's live state (Junior/Senior on, Quad and Oversight on, Grade and Leader off) reads as Junior/Senior, Notices offered", () => {
    const h = body([{ role: 'admin' }], { roles: { enabled: { oversight: true, grade: false, quad: true, leader: false } } });
    expect(h).toContain('<option value="junior-senior" selected>Junior/Senior</option>');
    expect(h).toContain('id="setup-notices"');
    const d = body([{ role: 'admin' }], { structure: { cohortModel: 'none' }, roles: { enabled: { quad: false, leader: true } } });
    expect(d).toContain('<option value="oversight-leaders" selected>Oversight and leaders</option>');
    expect(d).not.toContain('setup-notices');
  });
});
