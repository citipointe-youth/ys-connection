import { describe, it, expect } from 'vitest';
import { canAccessGrade, quadGradesOf } from '../services/access-control';
import { quadLabelFor } from '../core/types/enums';

const jr = { role: 'quad', quad: 'g79' } as never;
const sr = { role: 'quad', quad: 'b1012' } as never;

describe.each([[6, true], [7, false]] as const)('junior/senior quad brackets, gradeMin=%i', (gradeMin, on) => {
  const st = { gradeMin };
  it('junior includes grade 6 only when on; senior stays 10-12', () => {
    expect(quadGradesOf('g79', st)).toEqual(on ? [6, 7, 8, 9] : [7, 8, 9]);
    expect(quadGradesOf('b79', st)).toEqual(on ? [6, 7, 8, 9] : [7, 8, 9]);
    expect(quadGradesOf('b1012', st)).toEqual([10, 11, 12]);
    expect(canAccessGrade(jr, 6, st)).toBe(on);
    expect(canAccessGrade(jr, 7, st)).toBe(true);
    expect(canAccessGrade(sr, 6, st)).toBe(false);
    expect(canAccessGrade(sr, 10, st)).toBe(true);
  });
  it('label shows the real range', () => {
    expect(quadLabelFor('g79', false, gradeMin)).toBe(on ? 'Girls Yr 6–9' : 'Girls Yr 7–9');
    expect(quadLabelFor('b1012', false, gradeMin)).toBe('Boys Yr 10–12');
  });
});
