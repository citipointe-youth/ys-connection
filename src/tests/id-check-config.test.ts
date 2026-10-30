import { describe, it, expect } from 'vitest';
import { MinistryConfigSchema, MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import { MODULE_TREE, resolveModules } from '../core/module-tree';

const parseId = (idChecks: unknown) => MinistryConfigSchema.safeParse({ idChecks });

describe('ID checks config', () => {
  it('defaults: module off, rhythm unset, every 6 months', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.modules.idChecks).toBe('off');
    expect(MINISTRY_CONFIG_DEFAULTS.idChecks).toEqual({ cycleStart: '', intervalMonths: 6 });
  });
  it('intervalMonths is an integer 1-12', () => {
    expect(parseId({ intervalMonths: 13 }).success).toBe(false);
    expect(parseId({ intervalMonths: 0 }).success).toBe(false);
    expect(parseId({ intervalMonths: 2.5 }).success).toBe(false);
    expect(parseId({ intervalMonths: 1 }).success).toBe(true);
    expect(parseId({ intervalMonths: 12 }).success).toBe(true);
  });
  it('cycleStart is empty or a real YYYY-MM-DD day', () => {
    expect(parseId({ cycleStart: '2026-13-01' }).success).toBe(false);
    expect(parseId({ cycleStart: '2026-02-30' }).success).toBe(false);
    expect(parseId({ cycleStart: '2026-11-1' }).success).toBe(false);
    expect(parseId({ cycleStart: '2026-11-01' }).success).toBe(true);
    expect(parseId({ cycleStart: '' }).success).toBe(true);
  });
  it('a stored config with no idChecks keys still parses to the defaults', () => {
    const c = MinistryConfigSchema.parse({ modules: { notices: 'on' } });
    expect(c.idChecks).toEqual({ cycleStart: '', intervalMonths: 6 });
    expect(c.modules.idChecks).toBe('off');
  });
  it('PATCH merge keeps the rest of idChecks and accepts the module switch', () => {
    const merged = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { idChecks: 'on' }, idChecks: { cycleStart: '2026-11-01' } });
    expect(merged.modules.idChecks).toBe('on');
    expect(merged.idChecks).toEqual({ cycleStart: '2026-11-01', intervalMonths: 6 });
  });
  it('module tree lists idChecks after notices, with no parent or needs', () => {
    const keys = MODULE_TREE.map((n) => n.key);
    expect(keys.indexOf('idChecks')).toBe(keys.indexOf('notices') + 1);
    expect(MODULE_TREE.find((n) => n.key === 'idChecks')).toEqual({ key: 'idChecks', label: 'ID Checks' });
    expect(resolveModules({ ...MINISTRY_CONFIG_DEFAULTS.modules, idChecks: 'on' } as any).idChecks).toBe('on');
  });
});
