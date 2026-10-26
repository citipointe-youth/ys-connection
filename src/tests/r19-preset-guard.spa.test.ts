import { describe, it, expect, vi } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { makeSettingsService } from '../services/settings.service';
import { InMemorySettingsRepository, InMemoryAuditRepository, InMemoryUserRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { brisbaneElvanto } from './helpers/brisbane-elvanto';

// CY-D1 / PY-B1 (review 2026-10-19, presets KEPT by ruling D3): a Youth Setup preset changes only
// the preset fields (structure / roles / CA, Lifegroups, Export guides). Module states, Bus settings
// and branding survive a preset tap + Save, and a tap asks first.
const ADMIN = { id: 'a1', role: 'admin', displayName: 'Admin', grade: null, quad: null } as unknown as Actor;
const SRC = loadIndexHtml();
const block = (name: string) => { const i = SRC.indexOf(`const ${name} = {`); return SRC.slice(i, SRC.indexOf('\n};', i) + 3); };
const line = (name: string) => (new RegExp(`^const ${name} = .*$`, 'm').exec(SRC) ?? [''])[0];
const PRELUDE = [block('PRESET_CONFIGS_CLIENT'), line('PRESET_SERVICE_MIN_ATTENDANCE_CLIENT'), block('MINISTRY_CONFIG_DEFAULTS_CLIENT')].join('\n');

async function stored() {
  const repo = new InMemorySettingsRepository();
  const users = new InMemoryUserRepository();
  const audit = new InMemoryAuditRepository();
  await Promise.all([repo.init(), users.init(), audit.init()]);
  const onIntakeOff = vi.fn(async () => {});
  const svc = makeSettingsService(repo, audit, users, onIntakeOff);
  await svc.update(ADMIN, { ministryConfig: {
    branding: { ministryName: 'YS Gold Coast', appName: 'GC App', accent: '#ff0000' },
    labels: { groupNameStrip: ['Gold Coast - YS - '] },
    elvanto: brisbaneElvanto(), // Y1b: turning New person on needs this location's forms
    modules: { intakeAdmin: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'on', newYouthForms: 'on', busMinistry: true, flowHiddenStep: { f1: 's2' } },
    busMinistry: { churchAddress: '1 Church St', churchPlaceId: 'pl1', coordinatorLeaderIds: ['L1'], leaveTime: '20:30' },
  } } as any);
  return { svc, onIntakeOff };
}

describe('CY-D1 preset guard', () => {
  it('a preset tap + Save keeps intake, link modules, Bus and branding', async () => {
    const { svc, onIntakeOff } = await stored();
    const before = (await svc.get()).ministryConfig;
    for (const id of ['large-graded-au']) { // B1: the one preset
      const f = loadFns(['_deepMergeClient', '_presetPaths', '_applyMinistryPreset', '_setupBaseOf', '_setupPatch'],
        `${PRELUDE} let _setupDraft = ${JSON.stringify(before)}; let _setupServiceMinAttendance = 100; function _setupRerender() {} function __d() { return _setupDraft; }`,
        ['_applyMinistryPreset', '_setupPatch', '_setupBaseOf', '__d']);
      f._applyMinistryPreset(id);
      const d = f.__d();
      expect(d.structure.cohortModel).toBe('grades-quads');
      expect(d.roles.enabled.quad).toBe(true);
      await svc.update(ADMIN, { ...f._setupPatch(d, f._setupBaseOf(before)) } as any);
      const mc = (await svc.get()).ministryConfig;
      expect(mc.modules).toMatchObject({ intakeAdmin: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'on', newYouthForms: 'on', busMinistry: true, flowHiddenStep: { f1: 's2' } });
      expect(mc.busMinistry).toMatchObject({ churchAddress: '1 Church St', churchPlaceId: 'pl1', coordinatorLeaderIds: ['L1'], leaveTime: '20:30' });
      expect(mc.branding).toMatchObject({ ministryName: 'YS Gold Coast', appName: 'GC App', accent: '#ff0000' });
      expect(mc.labels.groupNameStrip).toEqual(['Gold Coast - YS - ']);
      expect(mc.modules.connectionAudit).toBe(before.modules.connectionAudit); // the one preset no longer touches it
    }
    expect(onIntakeOff).not.toHaveBeenCalled();
  });

  it('the one preset sets only the preset fields and the 100 attendance floor', () => {
    const f = loadFns(['_deepMergeClient', '_presetPaths', '_applyMinistryPreset'],
      `${PRELUDE} let _setupDraft = {}; let _setupServiceMinAttendance = 100; function _setupRerender() {} function __d() { return _setupDraft; } function __m() { return _setupServiceMinAttendance; }`,
      ['_applyMinistryPreset', '__d', '__m']);
    f._applyMinistryPreset('large-graded-au');
    const d = f.__d();
    expect(d).toEqual({ preset: 'large-graded-au' });
    expect(d.branding).toBeUndefined();
    expect(f.__m()).toBe(100);
  });

  it('a preset tap asks first; only the confirm applies it', () => {
    let html = '';
    const f = loadFns(['pickMinistryPreset'],
      `const MINISTRY_PRESETS_INFO = [{ id: 'large-graded-au', title: 'Junior/Senior Ministry' }]; function esc(s) { return String(s); } function modal(h) { html = h; } let html = ''; let applied = null; function _applyMinistryPreset(id) { applied = id; } function __s() { return { html, applied }; }`,
      ['pickMinistryPreset', '__s']);
    f.pickMinistryPreset('large-graded-au');
    html = f.__s().html;
    expect(f.__s().applied).toBeNull();
    expect(html).toContain("_applyMinistryPreset('large-graded-au')");
    expect(html).toMatch(/stays as it is/);
  });
});
