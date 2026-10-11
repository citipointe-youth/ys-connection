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

describe('modules.newYouthForms (off / shadow / on)', () => {
  const parseMode = (v: unknown) => MinistryConfigSchema.parse({ modules: { newYouthForms: v } }).modules.newYouthForms;
  it('defaults to off', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.modules.newYouthForms).toBe('off');
    expect(MinistryConfigSchema.parse({}).modules.newYouthForms).toBe('off');
  });
  it('accepts the three states and round-trips shadow', () => {
    expect(parseMode('off')).toBe('off');
    expect(parseMode('shadow')).toBe('shadow');
    expect(parseMode('on')).toBe('on');
    const again = MinistryConfigSchema.parse(MinistryConfigSchema.parse({ modules: { newYouthForms: 'shadow' } }));
    expect(again.modules.newYouthForms).toBe('shadow');
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
    expect(mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { newYouthForms: 'shadow' } }).modules.newYouthForms).toBe('shadow');
  });
});
