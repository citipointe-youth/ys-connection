// Modular setup Tasks 1.1 + 1.2: the module switchboard (src/core/module-tree.ts). MC4 is the live no-op guard.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MinistryConfigSchema } from '../core/ministry-config';
import { MODULE_TREE, resolveModules, moduleProblems, consentsHubOn } from '../core/module-tree';
import { makeSettingsService } from '../services/settings.service';
import { InMemorySettingsRepository, InMemoryAuditRepository, InMemoryUserRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import LIVE_MODULES from './fixtures/live-modules.json';

const NEW_KEYS = { liveLink: true, digest: true, camp: true, busConsentForm: true };
const ID_CHECKS_OFF = { idChecks: 'off' }; // ID Checks (2026-10-30): a new Off / On module, off by default
const LIVE = { ...LIVE_MODULES, ...NEW_KEYS, ...ID_CHECKS_OFF } as any; // live, as it reads after the migration
const ALL_ON = { ...LIVE, notices: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'on' };
const mods = (m: Record<string, unknown>) => MinistryConfigSchema.parse({ modules: m }).modules;
const RAW = MinistryConfigSchema.shape.modules.removeDefault().innerType(); // the schema before resolveModules

describe('MC1: defaults', () => {
  it('every old key keeps its schema default; the four new keys default to true', () => {
    expect(RAW.parse({})).toEqual({ connectionAudit: true, lifegroups: true, exportGuides: 'elvanto', busMinistry: false, newYouthForms: 'off',
      prayers: true, notices: 'off', intakeAdmin: 'off', flowHiddenStep: {}, ...NEW_KEYS, ...ID_CHECKS_OFF });
  });
  it('parse({}) resolves: the link screens follow New person (off), so Connection Audit and Public consent form (Bus off) read off', () => {
    expect(MinistryConfigSchema.parse({}).modules).toEqual({ connectionAudit: false, lifegroups: true, exportGuides: 'elvanto', busMinistry: false,
      newYouthForms: 'off', prayers: true, notices: 'off', checkin: 'off', lifegroupReport: 'off', flows: 'off', intakeAdmin: 'off', flowHiddenStep: {},
      liveLink: true, digest: true, camp: true, busConsentForm: false, ...ID_CHECKS_OFF });
  });
});

describe('MC2: one case per resolver rule', () => {
  it('1: missing link screens follow newYouthForms (legacy boolean too)', () => {
    expect(mods({ newYouthForms: 'admin' })).toMatchObject({ checkin: 'admin', lifegroupReport: 'admin', flows: 'admin' });
    expect(mods({ newYouthForms: true, flows: 'admin' })).toMatchObject({ newYouthForms: 'on', checkin: 'on', flows: 'admin' });
  });
  it('2: Live Elvanto link off turns the link screens, New person and Public consent form off', () => {
    expect(mods({ ...LIVE, liveLink: false, flows: 'on' })).toMatchObject({ checkin: 'off', lifegroupReport: 'off', flows: 'off',
      newYouthForms: 'off', busConsentForm: false });
  });
  it('3: New person off turns Intakes off', () => {
    expect(mods({ ...LIVE, newYouthForms: 'off' }).intakeAdmin).toBe('off');
    expect(mods({ ...LIVE, liveLink: false }).intakeAdmin).toBe('off'); // through New person
  });
  it('4: Bus off turns Public consent form off', () => {
    expect(mods({ ...LIVE, busMinistry: false }).busConsentForm).toBe(false);
  });
  it('5: Connection Audit reads off when Flows, Lifegroups or New person is off', () => {
    for (const k of ['flows', 'lifegroupReport', 'newYouthForms']) expect(mods({ ...LIVE, [k]: 'off' }).connectionAudit).toBe(false);
    expect(mods({ ...LIVE, flows: 'admin' }).connectionAudit).toBe(true); // admin only still counts as on
  });
  it('nothing else moves: Prayer, Notices, Digest, Camp, core settings', () => {
    const m = mods({ ...LIVE, liveLink: false, busMinistry: false });
    expect(m).toMatchObject({ prayers: true, notices: 'off', digest: true, camp: true, lifegroups: true, exportGuides: 'elvanto' });
  });
});

describe('MC3: moduleProblems', () => {
  it('[] for all on, for live and for the defaults', () => {
    expect(moduleProblems(ALL_ON)).toEqual([]);
    expect(moduleProblems(LIVE)).toEqual([]);
    expect(moduleProblems(MinistryConfigSchema.parse({}).modules)).toEqual([]);
  });
  it('one plain message per broken rule', () => {
    expect(moduleProblems({ ...ALL_ON, flows: 'off' })).toEqual(['Connection Audit needs Flows. Turn Connection Audit off first.']);
    expect(moduleProblems({ ...ALL_ON, newYouthForms: 'off' })).toEqual(['Intakes needs New person form. Turn Intakes off first.',
      'Connection Audit needs New person form. Turn Connection Audit off first.']);
    expect(moduleProblems({ ...ALL_ON, busMinistry: false })).toEqual(['Public consent form needs Bus. Turn Public consent form off first.']);
    expect(moduleProblems({ ...ALL_ON, liveLink: false, connectionAudit: false })).toEqual([
      'Public consent form needs Live Elvanto link. Turn Public consent form off first.',
      'New person form needs Live Elvanto link. Turn New person form off first.',
      'Flows needs Live Elvanto link. Turn Flows off first.',
      'Lifegroups needs Live Elvanto link. Turn Lifegroups off first.',
      'Check-in needs Live Elvanto link. Turn Check-in off first.']);
  });
  it('a missing link screen is checked as its newYouthForms value', () => {
    const { flows: _f, ...noFlows } = ALL_ON;
    expect(moduleProblems({ ...noFlows, liveLink: false, newYouthForms: 'off', checkin: 'off', lifegroupReport: 'off', intakeAdmin: 'off',
      connectionAudit: false, busConsentForm: false })).toEqual([]);
  });
});

describe('MC4: live no-op', () => {
  it('resolveModules(LIVE_MODULES) is LIVE_MODULES with the new keys added', () => {
    expect(resolveModules(LIVE)).toEqual(LIVE);
    expect(mods(LIVE_MODULES)).toEqual(LIVE); // the live row before the migration adds the keys
  });
  it('consentsHubOn is on for live and off only when nothing tracks consents', () => {
    expect(consentsHubOn(mods(LIVE))).toBe(true);
    expect(consentsHubOn(mods({ ...LIVE, intakeAdmin: 'off' }))).toBe(true);
    expect(consentsHubOn(mods({ ...LIVE, intakeAdmin: 'off', busConsentForm: false }))).toBe(false);
  });
});

describe('MC5: the console copy', () => {
  it('fixtures/module-tree.json is JSON.stringify(MODULE_TREE), byte for byte', () => {
    expect(readFileSync(join(__dirname, 'fixtures', 'module-tree.json'), 'utf8')).toBe(JSON.stringify(MODULE_TREE));
  });
  it('every parent / requires key is a tree key listed earlier; Camp is last', () => {
    MODULE_TREE.forEach((n, i) => {
      for (const k of [n.parent, ...(n.requires ?? [])].filter(Boolean)) expect(MODULE_TREE.findIndex((x) => x.key === k)).toBeLessThan(i);
    });
    expect(MODULE_TREE.at(-1)!.key).toBe('camp');
  });
});

const ADMIN: Actor = { id: 'a-test', role: 'admin', displayName: 'T', grade: null as any, quad: null as any };
async function live() {
  const repo = new InMemorySettingsRepository(); const audit = new InMemoryAuditRepository(); const users = new InMemoryUserRepository();
  await Promise.all([repo.init(), audit.init(), users.init()]);
  await repo.updateSettings({ ministryConfig: MinistryConfigSchema.parse({ modules: LIVE_MODULES }) });
  const hook = vi.fn(async () => {});
  return { repo, hook, svc: makeSettingsService(repo, audit, users, hook) };
}

describe('MC6: the write check', () => {
  it('turning Flows off while Connection Audit is on is refused (400 VALIDATION_ERROR, plain message); nothing stored', async () => {
    const { repo, svc } = await live();
    const before = structuredClone((await repo.getSettings()).ministryConfig);
    await expect(svc.update(ADMIN, { ministryConfig: { modules: { flows: 'off' } } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400,
      message: 'Connection Audit needs Flows. Turn Connection Audit off first.', extra: { problems: ['Connection Audit needs Flows. Turn Connection Audit off first.'] } });
    expect((await repo.getSettings()).ministryConfig).toEqual(before);
  });
  it('both in one save is fine', async () => {
    const { repo, svc } = await live();
    await svc.update(ADMIN, { ministryConfig: { modules: { flows: 'off', connectionAudit: false } } });
    expect((await repo.getSettings()).ministryConfig.modules).toMatchObject({ flows: 'off', connectionAudit: false, checkin: 'admin' });
  });
  it('a save that does not touch modules is never refused', async () => {
    const { svc } = await live();
    await expect(svc.update(ADMIN, { ministryConfig: { branding: { appName: 'X' } } })).resolves.toBeTruthy();
  });
});

describe('MC8 (server): Intakes off, directly or through a parent, needs confirmIntakeOff', () => {
  const NY_OFF = { newYouthForms: 'off', connectionAudit: false };
  const LINK_OFF = { liveLink: false, newYouthForms: 'off', checkin: 'off', lifegroupReport: 'off', flows: 'off', connectionAudit: false, busConsentForm: false };
  for (const [name, modules] of [['directly', { intakeAdmin: 'off' }], ['New person form off', NY_OFF], ['Live Elvanto link off', LINK_OFF]] as const) {
    it(name, async () => {
      const { repo, hook, svc } = await live();
      const before = structuredClone((await repo.getSettings()).ministryConfig);
      await expect(svc.update(ADMIN, { ministryConfig: { modules } })).rejects.toMatchObject({ code: 'INTAKE_OFF_CONFIRM', statusCode: 400,
        message: 'Turning Intakes off deletes waiting intake rows.' });
      expect((await repo.getSettings()).ministryConfig).toEqual(before);
      expect(hook).not.toHaveBeenCalled();
      await svc.update(ADMIN, { ministryConfig: { modules }, confirmIntakeOff: true });
      expect((await repo.getSettings()).ministryConfig.modules.intakeAdmin).toBe('off');
      expect(hook).toHaveBeenCalledTimes(1);
    });
  }
  it('a broken dependency is reported before the confirm (Live Elvanto link off with Flows still on)', async () => {
    const { svc } = await live();
    await expect(svc.update(ADMIN, { ministryConfig: { modules: { liveLink: false } } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('confirmIntakeOff is never stored in settings', async () => {
    const { repo, svc } = await live();
    await svc.update(ADMIN, { ministryConfig: { modules: { intakeAdmin: 'off' } }, confirmIntakeOff: true });
    expect('confirmIntakeOff' in (await repo.getSettings())).toBe(false);
  });
});
