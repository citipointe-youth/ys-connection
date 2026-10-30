import { describe, it, expect } from 'vitest';
import { parseGroupName, makeImportService } from '../services/import.service';
import { parseGroupMeta, buildLifegroupStats } from '../services/attendance-build';
import { canAccessQuadGroup } from '../services/access-control';
import { makeLifegroupStatsService } from '../services/lifegroup-stats.service';
import {
  InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
  InMemoryLifegroupRepository, InMemoryLifegroupWeekRepository, InMemoryLifegroupAttendanceRepository, InMemoryImportRepository,
  InMemorySettingsRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';

// 2026-10-24: "... Junior Girls Wednesday Lifegroup" (no Grade N) belongs to a leader quad; grade stays null.
const act = (role: Actor['role'], extra: Partial<Actor> = {}): Actor => ({ id: role, role, displayName: role, grade: null, quad: null, ...extra });
const ADMIN = act('admin');

describe('quad lifegroup names', () => {
  it('parseGroupName: Junior/Senior + gender -> quad, grade null; Grade N names unchanged', () => {
    expect(parseGroupName('YS - Junior Girls Wednesday Lifegroup')).toEqual({ grade: null, gender: 'female', quad: 'g79' });
    expect(parseGroupName('YS - Junior Guys Tuesday Lifegroup')).toEqual({ grade: null, gender: 'male', quad: 'b79' });
    expect(parseGroupName('YS - Senior Boys Thursday Lifegroup')).toEqual({ grade: null, gender: 'male', quad: 'b1012' });
    expect(parseGroupName('YS - Grade 9 Girls Lifegroup')).toEqual({ grade: 9, gender: 'female', quad: null });
    expect(parseGroupName('YS - Grade 11 Boys Lifegroup')).toEqual({ grade: 11, gender: 'male', quad: null });
    expect(parseGroupName('Senior Lifegroup')).toEqual({ grade: null, gender: null, quad: null }); // no gender = no quad
  });
  it('a suburb qualifier still parses (grade and junior/senior names)', () => {
    expect(parseGroupName('YS - Senior Guys Thursday Mt Gravatt Lifegroup')).toEqual({ grade: null, gender: 'male', quad: 'b1012' });
    expect(parseGroupName('YS - Grade 8 Girls Wednesday Mt Gravatt Lifegroup')).toEqual({ grade: 8, gender: 'female', quad: null });
    expect(parseGroupMeta('YS - Junior Girls Wednesday Mt Gravatt Lifegroup')).toEqual({ grade: null, gender: 'female', quad: 'g79' });
    expect(parseGroupMeta('YS - Grade 10 Boys Wednesday Mt Gravatt Lifegroup')).toEqual({ grade: 10, gender: 'male', quad: null });
  });
  it('Senior before the suburb, Guys before or after Senior (D8)', () => {
    expect(parseGroupName('Brisbane - Youth - Senior Guys Mt Gravatt Wednesday Lifegroup')).toEqual({ grade: null, gender: 'male', quad: 'b1012' });
    expect(parseGroupName('Brisbane - Youth - Guys Senior Mt Gravatt Wednesday Lifegroup')).toEqual({ grade: null, gender: 'male', quad: 'b1012' });
    expect(parseGroupName('Brisbane - Youth - Senior Girls Mt Gravatt Wednesday Lifegroup')).toEqual({ grade: null, gender: 'female', quad: 'g1012' });
    // the real renamed group (read 24 Oct) has no gender word, so no quad; never invent one
    expect(parseGroupName('Brisbane - YS - Senior Wednesday Mt Gravatt Lifegroup')).toEqual({ grade: null, gender: null, quad: null });
  });
  it('canAccessQuadGroup: admin/oversight, the quad login, a grade login with a grade in range + gender', () => {
    expect(canAccessQuadGroup(ADMIN, 'g79')).toBe(true);
    expect(canAccessQuadGroup(act('oversight'), 'b1012')).toBe(true);
    expect(canAccessQuadGroup(act('quad', { quad: 'g79' }), 'g79')).toBe(true);
    expect(canAccessQuadGroup(act('quad', { quad: 'b79' }), 'g79')).toBe(false);
    expect(canAccessQuadGroup(act('quad', { quad: 'g1012' }), 'g79')).toBe(false);
    expect(canAccessQuadGroup(act('grade', { grade: 8, gender: 'female' }), 'g79')).toBe(true);
    expect(canAccessQuadGroup(act('grade', { grade: 8, gender: 'male' }), 'g79')).toBe(false);
    expect(canAccessQuadGroup(act('grade', { grade: 11, gender: 'female' }), 'g79')).toBe(false);
    expect(canAccessQuadGroup(act('grade', { grade: 9, grades: [9, 10], gender: 'female' }), 'g1012')).toBe(true);
    expect(canAccessQuadGroup(act('leader'), 'g79')).toBe(false);
  });
  it('audit lifegroup stats use the name quad when grade is null', () => {
    const terms = [{ key: 'T', label: 'T', startDate: '2026-01-01', endDate: '2026-12-31' }] as Parameters<typeof buildLifegroupStats>[1];
    const out = buildLifegroupStats([{ name: 'Senior Girls Lifegroup', meetings: ['2026-04-13'],
      members: [{ id: 'p1', first_name: 'A', last_name: 'B', attendance: [true] }] }], terms);
    expect(out['T']![0]).toMatchObject({ grade: null, gender: 'female', quad: 'g1012' });
  });
  it('import stores the quad; stats show the group to its quad + grade logins, not in per-grade rows', async () => {
    const r = {
      students: new InMemoryStudentRepository(), sessions: new InMemoryServiceSessionRepository(),
      attendance: new InMemoryServiceAttendanceRepository(), imports: new InMemoryImportRepository(),
      settings: new InMemorySettingsRepository(), lifegroups: new InMemoryLifegroupRepository(),
      lifegroupWeeks: new InMemoryLifegroupWeekRepository(), lifegroupAttendance: new InMemoryLifegroupAttendanceRepository(),
      leaders: new InMemoryLeaderRepository(),
    };
    await Promise.all(Object.values(r).map((x) => x.init()));
    await r.settings.updateSettings({ serviceMinAttendance: 1 });
    const svc = makeImportService(r.students, r.sessions, r.attendance, r.imports, r.settings, r.lifegroups, r.lifegroupWeeks, r.lifegroupAttendance, r.leaders);
    await svc.importServiceCsv(ADMIN, [
      { first_name: 'Amy', last_name: 'A', gender: 'female', grade: 8, '2026-04-17': true, '2026-04-24': true },
    ], 'svc.csv');
    await svc.importGroupCsv(act('oversight'), { groups: [{ name: 'YS - Junior Girls Wednesday Lifegroup',
      meetings: ['2026-04-13', '2026-04-20'], members: [{ first_name: 'Amy', last_name: 'A', attendance: [true, true] }] }] }, 'grp.csv');
    const [lg] = await r.lifegroups.findAll();
    expect(lg).toMatchObject({ grade: null, gender: 'female', quad: 'g79' });

    const stats = makeLifegroupStatsService(r.students, r.lifegroups, r.lifegroupWeeks, r.lifegroupAttendance, r.sessions, r.settings);
    const admin = await stats.get(ADMIN);
    expect(admin.overall.current.uniqueAttenders).toBe(1);
    expect(admin.byGrade.flatMap((g) => g.lifegroups)).toHaveLength(0); // per-grade rows list only Grade N groups
    expect((await stats.get(act('quad', { quad: 'g79' }))).overall.current.uniqueAttenders).toBe(1);
    expect((await stats.get(act('grade', { grade: 8, gender: 'female' }))).overall.current.uniqueAttenders).toBe(1);
    expect((await stats.get(act('quad', { quad: 'g1012' }))).overall.current.uniqueAttenders).toBe(0);
  });
});
