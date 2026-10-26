import { describe, it, expect } from 'vitest';
import { gradeBands, computeQuad } from '../core/types/enums';
import { quadGradesOf } from '../services/access-control';
import { makeSettingsController } from '../api/controllers/settings.controller';
import { MinistryConfigSchema } from '../core/ministry-config';

describe('gradeBands (the one junior/senior split)', () => {
  it('Include Grade 6 on (gradeMin 6): junior 6-9, senior 10-12', () => {
    expect(gradeBands({ gradeMin: 6, gradeMax: 12 })).toEqual({ junior: [6, 7, 8, 9], senior: [10, 11, 12] });
  });
  it('Include Grade 6 off (gradeMin 7): junior 7-9, senior 10-12', () => {
    expect(gradeBands({ gradeMin: 7, gradeMax: 12 })).toEqual({ junior: [7, 8, 9], senior: [10, 11, 12] });
  });
  it('no structure: grade 6 counts as junior (old server default)', () => {
    expect(gradeBands()).toEqual({ junior: [6, 7, 8, 9], senior: [10, 11, 12] });
  });
  it('schema defaults give 7-9 / 10-12', () => {
    expect(gradeBands(MinistryConfigSchema.parse({}).structure)).toEqual({ junior: [7, 8, 9], senior: [10, 11, 12] });
  });
  it('quadGradesOf and computeQuad follow the helper', () => {
    expect(quadGradesOf('g79', { gradeMin: 7 })).toEqual([7, 8, 9]);
    expect(quadGradesOf('b79')).toEqual([6, 7, 8, 9]);
    expect(quadGradesOf('g1012', { gradeMin: 6 })).toEqual([10, 11, 12]);
    expect(computeQuad(6, 'female')).toBe('g79');
    expect(computeQuad(9, 'male')).toBe('b79');
    expect(computeQuad(10, 'female')).toBe('g1012');
    expect(computeQuad(12, 'male')).toBe('b1012');
    expect(computeQuad(5, 'male')).toBeNull();
    expect(computeQuad(13, 'male')).toBeNull();
  });
  it('the dead structure.brackets default is gone', () => {
    expect('brackets' in MinistryConfigSchema.parse({}).structure).toBe(false);
  });
});

describe('GET /settings contract: gradeBands', () => {
  const ctl = (structure: Record<string, unknown>) =>
    makeSettingsController({
      settings: { get: async () => ({ ministryConfig: MinistryConfigSchema.parse({ structure }) }) } as never,
    });
  it('Brisbane with Include Grade 6 on', async () => {
    const r = (await ctl({ gradeMin: 6, gradeMax: 12 }).get({} as never)) as any;
    expect(r.gradeBands).toEqual({ junior: [6, 7, 8, 9], senior: [10, 11, 12] });
    expect(r.ministryConfig.structure.gradeMin).toBe(6);
  });
  it('Include Grade 6 off', async () => {
    const r = (await ctl({ gradeMin: 7, gradeMax: 12 }).get({} as never)) as any;
    expect(r.gradeBands).toEqual({ junior: [7, 8, 9], senior: [10, 11, 12] });
  });
});

describe('SPA gradeBands mirrors the server helper', () => {
  it.each([[6, 12], [7, 12]])('gradeMin %i, gradeMax %i', async (gradeMin, gradeMax) => {
    const { loadFns } = await import('./helpers/extract-fn');
    const f = loadFns(['_structure', 'gradeBands', '_juniorMin', 'quadGrades', 'computeQuad'],
      `const S = { settings: { ministryConfig: { structure: { gradeMin: ${gradeMin}, gradeMax: ${gradeMax} } } } };`);
    expect(f.gradeBands()).toEqual(gradeBands({ gradeMin, gradeMax }));
    expect(f._juniorMin()).toBe(gradeMin);
    expect(f.quadGrades('g79')).toEqual(quadGradesOf('g79', { gradeMin, gradeMax }));
    expect(f.computeQuad(6, 'female')).toBe(gradeMin === 6 ? 'g79' : null);
    expect(f.computeQuad(10, 'male')).toBe('b1012');
  });
});
