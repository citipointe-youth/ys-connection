import { describe, it, expect } from 'vitest';
import {
  MinistryConfigSchema,
  MINISTRY_CONFIG_DEFAULTS,
  PRESET_CONFIGS,
  mergeMinistryConfig,
} from '../core/ministry-config';

describe('MinistryConfigSchema', () => {
  it('parses {} into MINISTRY_CONFIG_DEFAULTS, matching current YS Brisbane behaviour', () => {
    expect(MinistryConfigSchema.parse({})).toEqual(MINISTRY_CONFIG_DEFAULTS);
  });

  it('defaults every branding field to the current hardcoded values', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.branding.ministryName).toBe('Youth Society Brisbane');
    expect(MINISTRY_CONFIG_DEFAULTS.branding.appName).toBe('YS Connection');
    expect(MINISTRY_CONFIG_DEFAULTS.branding.accent).toBe('#1a1af2');
    expect(MINISTRY_CONFIG_DEFAULTS.branding.logoImage).toBe(null);
    expect(MINISTRY_CONFIG_DEFAULTS.modules.connectionAudit).toBe(true);
    expect(MINISTRY_CONFIG_DEFAULTS.structure.cohortModel).toBe('grades-quads');
    expect(MINISTRY_CONFIG_DEFAULTS.roles.enabled).toEqual({ director: true, grade: true, quad: true, leader: false });
  });

  it('rejects an invalid hex colour', () => {
    expect(() => MinistryConfigSchema.parse({ branding: { accent: 'blue' } })).toThrow();
  });

  it('the large-graded-au preset is a no-op (acceptance criterion #1)', () => {
    const merged = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, PRESET_CONFIGS['large-graded-au']);
    expect(merged).toEqual(MINISTRY_CONFIG_DEFAULTS);
  });
});

describe('mergeMinistryConfig', () => {
  it('deep-merges a partial patch, leaving every other field at its default', () => {
    const merged = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { branding: { accent: '#ff0000' } });
    expect(merged.branding.accent).toBe('#ff0000');
    expect(merged.branding.ministryName).toBe(MINISTRY_CONFIG_DEFAULTS.branding.ministryName);
    expect(merged.labels).toEqual(MINISTRY_CONFIG_DEFAULTS.labels);
    expect(merged.structure).toEqual(MINISTRY_CONFIG_DEFAULTS.structure);
  });

  it('applies the simple preset overrides on top of defaults', () => {
    const merged = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, PRESET_CONFIGS['simple']);
    expect(merged.structure.cohortModel).toBe('none');
    expect(merged.roles.enabled.director).toBe(false); // simple ministry (bug 8, 2026-07-11): Admin + Grade only
    expect(merged.roles.enabled.quad).toBe(false);
    expect(merged.roles.enabled.leader).toBe(false);
    expect(merged.roles.enabled.grade).toBe(true); // untouched by the preset — a simple ministry still uses Grade accounts
    expect(merged.modules.connectionAudit).toBe(false);
    expect(merged.modules.lifegroups).toBe(true);
    // Untouched by the preset — still default
    expect(merged.branding.accent).toBe(MINISTRY_CONFIG_DEFAULTS.branding.accent);
  });

  it('throws when the merged result is invalid', () => {
    expect(() => mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { branding: { accent: 'not-a-colour' } })).toThrow();
  });
});

describe('branding.logoSvg (removed 2026-07-12)', () => {
  it('a logoSvg key in a patch is silently dropped, not stored', () => {
    const merged = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, {
      branding: { logoSvg: '<svg onload=alert(1)>' },
    });
    expect((merged.branding as Record<string, unknown>)['logoSvg']).toBeUndefined();
  });
});

describe('modules.newYouthForms (off / admin / on)', () => {
  const parseMode = (v: unknown) => MinistryConfigSchema.parse({ modules: { newYouthForms: v } }).modules.newYouthForms;
  it('defaults to off', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.modules.newYouthForms).toBe('off');
    expect(MinistryConfigSchema.parse({}).modules.newYouthForms).toBe('off');
  });
  it('accepts the three states and round-trips admin', () => {
    expect(parseMode('off')).toBe('off');
    expect(parseMode('admin')).toBe('admin');
    expect(parseMode('on')).toBe('on');
    const again = MinistryConfigSchema.parse(MinistryConfigSchema.parse({ modules: { newYouthForms: 'admin' } }));
    expect(again.modules.newYouthForms).toBe('admin');
  });
  it('D9: reads the legacy shadow as admin, forever', () => {
    expect(parseMode('shadow')).toBe('admin');
    const m = MinistryConfigSchema.parse({ modules: { newYouthForms: 'shadow', checkin: 'shadow', lifegroupReport: 'shadow', flows: 'shadow' } }).modules;
    expect([m.newYouthForms, m.checkin, m.lifegroupReport, m.flows]).toEqual(['admin', 'admin', 'admin', 'admin']);
    expect(MinistryConfigSchema.parse({ modules: { newYouthForms: 'shadow' } }).modules.flows).toBe('admin'); // inherited
    expect(mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { checkin: 'shadow' } } as any).modules.checkin).toBe('admin');
  });
  it('still reads the old boolean: true -> on, false -> off', () => {
    expect(parseMode(true)).toBe('on');
    expect(parseMode(false)).toBe('off');
  });
  it('rejects junk, like any other bad enum value', () => {
    expect(() => parseMode('admin only')).toThrow();
    expect(() => parseMode(1)).toThrow();
  });
  it('a PATCH carrying the old boolean merges to the new state', () => {
    expect(mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { newYouthForms: true } } as any).modules.newYouthForms).toBe('on');
    expect(mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { newYouthForms: 'admin' } }).modules.newYouthForms).toBe('admin');
  });
});

describe('T10 link modules checkin / lifegroupReport / flows (off / admin / on)', () => {
  const KEYS = ['checkin', 'lifegroupReport', 'flows'] as const;
  it('a stored config without them inherits newYouthForms (nothing changes on deploy)', () => {
    const m = MinistryConfigSchema.parse({ modules: { newYouthForms: 'admin' } }).modules;
    for (const k of KEYS) expect(m[k], k).toBe('admin');
    const legacy = MinistryConfigSchema.parse({ modules: { newYouthForms: true } }).modules;
    for (const k of KEYS) expect(legacy[k], k).toBe('on');
    for (const k of KEYS) expect(MINISTRY_CONFIG_DEFAULTS.modules[k], k).toBe('off');
  });
  it('each key is independent once set, and survives a re-parse and a merge', () => {
    const m = MinistryConfigSchema.parse({ modules: { newYouthForms: 'off', checkin: 'on', lifegroupReport: 'admin' } }).modules;
    expect([m.checkin, m.lifegroupReport, m.flows]).toEqual(['on', 'admin', 'off']);
    const again = MinistryConfigSchema.parse(MinistryConfigSchema.parse({ modules: m }));
    expect(again.modules.lifegroupReport).toBe('admin');
    const merged = mergeMinistryConfig(again, { modules: { newYouthForms: 'on' } });
    expect([merged.modules.newYouthForms, merged.modules.checkin, merged.modules.flows]).toEqual(['on', 'on', 'off']);
    expect(() => MinistryConfigSchema.parse({ modules: { flows: true } })).toThrow();
  });
});

describe('logins and modules.prayers (October rework)', () => {
  it('parses {} with Simple logins off and Prayers on', () => {
    const cfg = MinistryConfigSchema.parse({});
    expect(cfg.logins).toEqual({ simple: false, retiredGradeIds: [], gradeRoleWasOn: true });
    expect(cfg.modules.prayers).toBe(true);
  });

  it('parses a pre-rework stored config with no logins key and no modules.prayers', () => {
    const old = {
      version: 1,
      preset: 'large-graded-au',
      roles: { enabled: { director: true, grade: true, quad: true, leader: false } },
      modules: { connectionAudit: true, lifegroups: true, exportGuides: 'elvanto', busMinistry: true, newYouthForms: 'shadow' },
      busMinistry: { churchAddress: '1 Church St', coordinatorLeaderIds: ['l1'] },
    };
    const cfg = MinistryConfigSchema.parse(old);
    expect(cfg.logins).toEqual({ simple: false, retiredGradeIds: [], gradeRoleWasOn: true });
    expect(cfg.modules.prayers).toBe(true);
    expect(cfg.modules.busMinistry).toBe(true);
    expect(cfg.modules.newYouthForms).toBe('admin') // D9: legacy shadow reads as admin;
  });

  it('mergeMinistryConfig deep-merges logins (keeps retiredGradeIds/gradeRoleWasOn)', () => {
    const base = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, {
      logins: { simple: false, retiredGradeIds: ['u1', 'u2'], gradeRoleWasOn: false },
    });
    const merged = mergeMinistryConfig(base, { logins: { simple: true } });
    expect(merged.logins).toEqual({ simple: true, retiredGradeIds: ['u1', 'u2'], gradeRoleWasOn: false });
  });

  it('MINISTRY_CONFIG_DEFAULTS has logins.simple false and modules.prayers true', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.logins.simple).toBe(false);
    expect(MINISTRY_CONFIG_DEFAULTS.modules.prayers).toBe(true);
  });
});
