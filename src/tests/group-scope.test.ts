// 2026-11-21 (Tom, year-end rename): who a lifegroup is for comes from its name only. Mixed and junior+senior groups were
// admin-only or junior-only; a group's own leaders always see it.
import { describe, it, expect } from 'vitest';
import { groupScopeOf } from '../core/types/enums';
import { groupVisible } from '../services/link.service';
import { parseGroupName } from '../services/import.service';
import type { Actor } from '../core/entities/user';
import type { LinkGroupRow } from '../core/link-types';

const act = (role: Actor['role'], extra: Partial<Actor> = {}): Actor => ({ id: role, role, displayName: role, grade: null, quad: null, ...extra });
const Q = (quad: string) => act('quad', { quad: quad as Actor['quad'] });
const S = {} as Parameters<typeof groupVisible>[2];
const grp = (name: string, members: LinkGroupRow['members'] = []): LinkGroupRow =>
  ({ groupId: 'g1', name, meets: '', members, thisWeek: null, history: [], ...parseGroupName(name) } as unknown as LinkGroupRow);
const sees = (a: Actor, name: string) => groupVisible(a, grp(name), S);
const quadsSeeing = (name: string) => ['g79', 'b79', 'g1012', 'b1012'].filter((q) => sees(Q(q), name));

describe('groupScopeOf: grades or quads from the name', () => {
  it('Grade N, a range and a list; Guys is a gender', () => {
    expect(groupScopeOf('YS - Grade 9 Girls Lifegroup')).toEqual({ grades: [9], genders: ['female'], quads: [] });
    expect(groupScopeOf('YS - Grade 9-10 Girls Lifegroup').grades).toEqual([9, 10]);
    expect(groupScopeOf('YS - Grades 11 & 12 Guys Lifegroup')).toEqual({ grades: [11, 12], genders: ['male'], quads: [] });
    expect(groupScopeOf('YS - Grade 7 and 8 Lifegroup')).toEqual({ grades: [7, 8], genders: ['female', 'male'], quads: [] });
  });
  it('Junior / Senior / both / neither x Girls / Guys / neither', () => {
    expect(groupScopeOf('YS - Junior Girls Wednesday Lifegroup').quads).toEqual(['g79']);
    expect(groupScopeOf('Brisbane - YS - Senior Wednesday Mt Gravatt Lifegroup').quads).toEqual(['g1012', 'b1012']);
    expect(groupScopeOf('YS - Junior & Senior Girls Lifegroup').quads).toEqual(['g79', 'g1012']);
    expect(groupScopeOf('YS - Youth Lifegroup').quads).toEqual(['g79', 'b79', 'g1012', 'b1012']);
    expect(groupScopeOf('YS - Guys and Girls Junior Lifegroup').quads).toEqual(['g79', 'b79']);
  });
});

describe('groupVisible: the three year-end cases', () => {
  it('mixed across all four quads: every quad login', () => {
    expect(quadsSeeing('YS - Youth Lifegroup')).toEqual(['g79', 'b79', 'g1012', 'b1012']);
    expect(sees(act('grade', { grade: 11, gender: 'male' }), 'YS - Youth Lifegroup')).toBe(true);
  });
  it('single gender in one quad: that quad only (unchanged)', () => {
    expect(quadsSeeing('YS - Junior Girls Wednesday Lifegroup')).toEqual(['g79']);
  });
  it('single gender across junior and senior: both quads of that gender', () => {
    expect(quadsSeeing('YS - Junior & Senior Girls Lifegroup')).toEqual(['g79', 'g1012']);
    expect(quadsSeeing('YS - Girls Lifegroup')).toEqual(['g79', 'g1012']);
  });
  it('mixed senior: both senior quads; a Grade range: each grade', () => {
    expect(quadsSeeing('Brisbane - YS - Senior Wednesday Mt Gravatt Lifegroup')).toEqual(['g1012', 'b1012']);
    expect(sees(act('grade', { grade: 10, gender: 'female' }), 'YS - Grade 9-10 Girls Lifegroup')).toBe(true);
    expect(sees(act('grade', { grade: 10, gender: 'female' }), 'YS - Grade 10 Guys Lifegroup')).toBe(false);
  });
  it("a group's own leader sees it whatever their login's scope; another person does not", () => {
    const g = grp('YS - Grade 9 Girls Lifegroup', [{ personId: 'p-lead', name: 'L', leader: true }, { personId: 'p-kid', name: 'K', leader: false }] as LinkGroupRow['members']);
    const boy12 = act('grade', { grade: 12, gender: 'male' });
    expect(groupVisible(boy12, g, S)).toBe(false);
    expect(groupVisible(boy12, g, S, 'p-lead')).toBe(true);
    expect(groupVisible(boy12, g, S, 'p-kid')).toBe(false);
  });
});

describe('parseGroupName: Guys counts as male', () => {
  it('Grade 10 Guys -> male', () => {
    expect(parseGroupName('YS - Grade 10 Guys Lifegroup').gender).toBe('male');
  });
});

describe('import: group id by name only when the name is unique', () => {
  it('a name two groups share maps to no id (reconcile shows it) instead of the last one', async () => {
    const { groupIdsByName } = await import('../services/import.service');
    const m = groupIdsByName([{ name: 'YS - Grade 9 Girls Lifegroup', groupId: 'a' }, { name: ' ys - grade 9 girls lifegroup', groupId: 'b' },
      { name: 'YS - Grade 10 Boys Lifegroup', groupId: 'c' }]);
    expect([...m]).toEqual([['ys - grade 10 boys lifegroup', 'c']]);
  });
});
