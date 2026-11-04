// Import > Not on the Elvanto roster (2026-11-04). Fictional names only.
import { describe, it, expect } from 'vitest';
import { makeStudentService, type OffRosterDeps } from '../services/student.service';
import { offRoster, OFF_ROSTER_MIN_ACTIVE } from '../services/link-rules';
import { InMemoryStudentRepository } from '../repositories/in-memory';
import { loadFns } from './helpers/extract-fn';
import type { Actor } from '../core/entities/user';
import type { Student } from '../core/entities/student';
import type { LinkRosterRow } from '../core/link-types';

const T = '2026-11-01T00:00:00.000Z';
const actor = (role: string) => ({ id: 'a', role, displayName: 'Sample', grade: null, quad: null }) as unknown as Actor;
const ADMIN = actor('admin');
const stu = (id: string, firstName: string, over: Partial<Student> = {}) =>
  ({ id, firstName, lastName: 'Dummyton', gender: 'female', grade: 9, graduatedAt: null, createdAt: T, updatedAt: T, ...over }) as Student;
const row = (firstName: string, over: Partial<LinkRosterRow> = {}): LinkRosterRow => ({ personId: `p-${firstName}`, firstName, lastName: 'Dummyton',
  gender: 'female', grade: 9, kind: 'student', active: true, studentId: null, match: 'none', updatedAt: T, ...over });
// A roster big enough to trust, of people who are not YS students.
const filler = (n = OFF_ROSTER_MIN_ACTIVE) => Array.from({ length: n }, (_, i) => row(`Filler${i}`));

async function world(students: Student[], roster: LinkRosterRow[], pushed = true) {
  const repo = new InMemoryStudentRepository();
  await repo.init();
  await repo.saveMany(students);
  for (const s of students) if (s.graduatedAt) await repo.setGraduated(s.id, s.graduatedAt);
  const deps: OffRosterDeps = {
    link: { roster: async () => roster, mirrorState: async () => (pushed ? [{ kind: 'roster', takenAt: T, consoleId: 'c', rowCount: roster.length, appliedAt: T }] : []) },
    sessions: { findAll: async () => [{ id: 'old', sessionDate: '2026-02-06' }, { id: 'new', sessionDate: '2026-10-30' }] as never },
    serviceAttendance: { findAll: async () => [
      { studentId: 's-new', sessionId: 'new', attended: true }, { studentId: 's-old', sessionId: 'old', attended: true },
      { studentId: 's-old', sessionId: 'new', attended: false }] },
    weeks: { findAll: async () => [{ id: 'w', weekStart: '2026-05-04' }] as never },
    lifegroupAttendance: { findAll: async () => [{ studentId: 's-old', weekId: 'w', lifegroupId: 'g', groupMet: true, attended: true }] },
  };
  return { repo, svc: makeStudentService(repo, undefined, undefined, undefined, undefined, deps) };
}

describe('offRoster', () => {
  const ok = [stu('a', 'Amy'), stu('b', 'Ben'), stu('c', 'Cal'), stu('d', 'Dee'), stu('e', 'Eve')];
  it('leaves out a linked student, a same-name active row of any kind, and a graduated student; an inactive row does not count', () => {
    const roster = [...filler(), row('Other', { studentId: 'a' }), row('B-en', { kind: 'leader' }),
      row('Cal', { active: false }), row('Zed', { active: false, studentId: 'zed' })];
    const rows = offRoster(true, roster, [...ok, stu('zed', 'Zed'), stu('g', 'Gil', { graduatedAt: T })]);
    expect(rows.held).toBe(false);
    expect(rows.rows.map((s) => s.id)).toEqual(['c', 'd', 'e']);
  });
  it('holds with no push, or a small roster', () => {
    expect(offRoster(false, filler(), ok)).toEqual({ rows: [], held: true });
    expect(offRoster(true, [], ok)).toEqual({ rows: [], held: true });
    expect(offRoster(true, filler(OFF_ROSTER_MIN_ACTIVE - 1), ok)).toEqual({ rows: [], held: true });
    // Leader rows do not make a roster real.
    expect(offRoster(true, filler().map((r) => ({ ...r, kind: 'leader' as const })), ok)).toEqual({ rows: [], held: true });
  });
  it('holds when over half of the students would count, not at exactly half', () => {
    const half = [stu('a', 'Amy'), stu('b', 'Ben')];
    expect(offRoster(true, [...filler(), row('Amy')], half).held).toBe(false);
    expect(offRoster(true, filler(), half)).toEqual({ rows: [], held: true });
  });
});

describe('the off-roster routes', () => {
  const roster = [...filler(), row('Keep')];
  const students = [stu('s-keep', 'Keep'), stu('s-new', 'Newer'), stu('s-old', 'Older'), stu('s-none', 'Aaron'), stu('s-5', 'E'), stu('s-6', 'F'), stu('s-7', 'G'), stu('s-8', 'H', { graduatedAt: T })];
  const on = Array.from({ length: 8 }, (_, i) => stu(`x${i}`, `Filler${i}`)); // on the roster, so the candidates stay under half

  it('admin only, both routes', async () => {
    const { svc } = await world([...students, ...on], roster);
    for (const role of ['oversight', 'quad', 'grade', 'leader']) {
      await expect(svc.listOffRoster(actor(role))).rejects.toMatchObject({ statusCode: 403 });
      await expect(svc.graduateOffRoster(actor(role), { ids: ['s-new'] })).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('lists name, grade and last attended, newest first, no attendance last', async () => {
    const { svc } = await world([...students, ...on], roster);
    const r = await svc.listOffRoster(ADMIN);
    expect(r.held).toBe(false);
    expect(r.rosterAt).toBe(T);
    expect(r.rows[0]).toEqual({ id: 's-new', name: 'Newer Dummyton', grade: 9, lastAttended: '2026-10-30' });
    expect(r.rows[1]).toMatchObject({ id: 's-old', lastAttended: '2026-05-04' }); // the lifegroup is newer than its service; a missed one does not count
    expect(r.rows.slice(2).map((x) => x.lastAttended)).toEqual([null, null, null, null]);
    expect(r.rows.map((x) => x.id)).not.toContain('s-8');
    expect(r.rows.map((x) => x.id)).not.toContain('s-keep');
  });

  it('with no roster stored nobody is listed and nobody can be graduated', async () => {
    const { svc, repo } = await world([...students, ...on], [], false);
    expect(await svc.listOffRoster(ADMIN)).toEqual({ held: true, rosterAt: null, rows: [] });
    expect(await svc.graduateOffRoster(ADMIN, { ids: ['s-new'] })).toEqual({ graduated: [], skipped: ['s-new'] });
    expect((await repo.findById('s-new'))!.graduatedAt ?? null).toBeNull();
  });

  it('a list with one non-candidate graduates the rest and skips that one', async () => {
    const { svc, repo } = await world([...students, ...on], roster);
    const r = await svc.graduateOffRoster(ADMIN, { ids: ['s-new', 's-keep', 's-new', 's-8', 'no-such'] });
    expect(r).toEqual({ graduated: ['s-new'], skipped: ['s-keep', 's-8', 'no-such'] });
    expect((await repo.findById('s-new'))!.graduatedAt).toBeTruthy();
    expect((await repo.findById('s-keep'))!.graduatedAt ?? null).toBeNull();
    expect((await repo.findById('s-8'))!.graduatedAt).toBe(T); // stamp unchanged
  });

  it('refuses an empty list and over 50', async () => {
    const { svc } = await world(students, roster);
    await expect(svc.graduateOffRoster(ADMIN, { ids: [] })).rejects.toBeTruthy();
    await expect(svc.graduateOffRoster(ADMIN, { ids: Array.from({ length: 51 }, (_, i) => `i${i}`) })).rejects.toBeTruthy();
  });
});

describe('the card', () => {
  const { _offHtml } = loadFns(['esc', '_icJs', '_offHtml'],
    "const _OFF_PAGE = 50; const _gradeWord = () => 'Year'; const fmtDay = (d) => String(d);", ['_offHtml']);
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `S${i}`, grade: 9, lastAttended: null }));

  it('escapes the name and guards the id in the onclick', () => {
    const h = _offHtml({ rows: [{ id: "x');alert(1)//\"", name: '<img src=x onerror=alert(1)>', grade: null, lastAttended: null }], from: 0 }, false);
    expect(h).not.toContain('<img');
    expect(h).not.toContain("x');alert");
    expect(h).toContain('Not on the Elvanto roster (1)');
  });
  it('"all shown" is one page of at most 50, and the count is the whole list', () => {
    const h = _offHtml({ rows: rows(60), from: 0 }, true);
    expect(h).toContain('Not on the Elvanto roster (60)');
    expect(h).toContain('Graduate all shown (50)');
    expect(h).toContain('1-50 of 60');
    expect(_offHtml({ rows: rows(60), from: 50 }, true)).toContain('Graduate all shown (10)');
  });
  it('held says why and offers nothing; an empty list shows nothing', () => {
    const h = _offHtml({ rows: [], held: true, from: 0 }, false);
    expect(h).toContain('no full Elvanto roster');
    expect(h).not.toContain('Graduate');
    expect(_offHtml({ rows: [], held: false, from: 0 }, false)).toBe('');
  });
});
