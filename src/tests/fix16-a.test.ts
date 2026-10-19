// Lane A (fix round 16 Oct): F-01 leader scoping, F-10 CSV export, F-27 search, F-50(a) unknown gender.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeConnectionService } from '../services/connection.service';
import { makeStudentService } from '../services/student.service';
import { makeLeaderService } from '../services/leader.service';
import { makeFollowupService } from '../services/followup.service';
import { leaderInScope } from '../services/access-control';
import { personVisible } from '../services/link.service';
import {
  InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryConnectionRepository, InMemorySettingsRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository, InMemoryLifegroupWeekRepository, InMemoryLifegroupAttendanceRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { ForbiddenError } from '../core/errors/app-error';

const A = (role: string, o: Partial<Actor> = {}): Actor => ({ id: 'a-' + role, role: role as any, displayName: role, grade: null as any, quad: null as any, gender: null, ...o });
const ADMIN = A('admin');
const G79 = A('quad', { quad: 'g79' as any });   // junior girls
const B79 = A('quad', { quad: 'b79' as any });   // junior guys

let w: Awaited<ReturnType<typeof build>>;
async function build() {
  const studentRepo = new InMemoryStudentRepository(), leaderRepo = new InMemoryLeaderRepository();
  const connRepo = new InMemoryConnectionRepository(), settingsRepo = new InMemorySettingsRepository();
  for (const r of [studentRepo, leaderRepo, connRepo, settingsRepo]) await r.init();
  const studentSvc = makeStudentService(studentRepo);
  const leaderSvc = makeLeaderService(leaderRepo);
  const connSvc = makeConnectionService(connRepo, studentRepo, leaderRepo, settingsRepo);
  const sess = new InMemoryServiceSessionRepository(), att = new InMemoryServiceAttendanceRepository();
  const wk = new InMemoryLifegroupWeekRepository(), gatt = new InMemoryLifegroupAttendanceRepository();
  for (const r of [sess, att, wk, gatt] as any[]) if (r.init) await r.init();
  const followSvc = makeFollowupService(connRepo, studentRepo, leaderRepo, sess, att, wk, gatt);
  const s8f = await studentSvc.create(ADMIN, { firstName: 'Jun', lastName: 'Girl', gender: 'female', grade: 8, mobile: '0400000001' });
  const s11f = await studentSvc.create(ADMIN, { firstName: 'Sen', lastName: 'Girl', gender: 'female', grade: 11, mobile: '0400000002' });
  const s8m = await studentSvc.create(ADMIN, { firstName: 'Jun', lastName: 'Guy', gender: 'male', grade: 8, mobile: '0400000003' });
  const s11m = await studentSvc.create(ADMIN, { firstName: 'Sen', lastName: 'Guy', gender: 'male', grade: 11 });
  const jg = await leaderSvc.create(ADMIN, { fullName: 'Junior Girl Leader', gender: 'female', grades: [8] });
  const sg = await leaderSvc.create(ADMIN, { fullName: 'Senior Girl Leader', gender: 'female', grades: [11] });
  const ng = await leaderSvc.create(ADMIN, { fullName: 'No Gender Leader', grades: [8] });
  const eg = await leaderSvc.create(ADMIN, { fullName: 'No Grades Leader', gender: 'female', grades: [] });
  for (const s of [s8f, s11f, s8m]) await connSvc.assign(ADMIN, { studentId: s.id, leaderId: jg.id });
  await connSvc.assign(ADMIN, { studentId: s11f.id, leaderId: sg.id });
  await connSvc.assign(ADMIN, { studentId: s8f.id, leaderId: ng.id });
  return { studentSvc, leaderSvc, connSvc, followSvc, s8f, s11f, s8m, s11m, jg, sg, ng, eg };
}
beforeEach(async () => { w = await build(); });

describe('F-01 leader scoping', () => {
  it('leaderInScope: strict gender + grade rule, null gender and [] grades fail', () => {
    expect(leaderInScope(G79, w.jg)).toBe(true);
    expect(leaderInScope(G79, w.sg)).toBe(false);
    expect(leaderInScope(G79, w.ng)).toBe(false);
    expect(leaderInScope(G79, w.eg)).toBe(false);
    expect(leaderInScope(ADMIN, w.ng)).toBe(true);
    expect(leaderInScope(A('leader', { leaderId: w.jg.id } as any), w.sg)).toBe(false);
  });
  it('quad gets 403 on an out-of-scope or gender-null leader summary', async () => {
    await expect(w.connSvc.leaderSummary(G79, w.sg.id)).rejects.toThrow(ForbiddenError);
    await expect(w.connSvc.leaderSummary(G79, w.ng.id)).rejects.toThrow(ForbiddenError);
    await expect(w.connSvc.leaderSummary(B79, w.jg.id)).rejects.toThrow(ForbiddenError);
  });
  it('own-bracket leader summary returns only canAccessStudent students (no out-of-scope phones)', async () => {
    const r = await w.connSvc.leaderSummary(G79, w.jg.id);
    expect(r.students.map((s) => s.id)).toEqual([w.s8f.id]);
    expect(JSON.stringify(r)).not.toContain('0400000002');
    expect(JSON.stringify(r)).not.toContain('0400000003');
  });
  it('admin summary unchanged', async () => {
    const r = await w.connSvc.leaderSummary(ADMIN, w.jg.id);
    expect(r.students.length).toBe(3);
  });
  it('junior leader may only read its own summary', async () => {
    const me = A('leader', { leaderId: w.jg.id } as any);
    await expect(w.connSvc.leaderSummary(me, w.sg.id)).rejects.toThrow(ForbiddenError);
    expect((await w.connSvc.leaderSummary(me, w.jg.id)).students.length).toBe(3);
  });
  it('listByLeader and followup get the same guard', async () => {
    await expect(w.connSvc.listByLeader(G79, w.sg.id)).rejects.toThrow(ForbiddenError);
    expect((await w.connSvc.listByLeader(G79, w.jg.id)).map((c) => c.studentId)).toEqual([w.s8f.id]);
    await expect(w.followSvc.leaderFollowup(G79, w.sg.id)).rejects.toThrow(ForbiddenError);
  });
  it('?pick=1 list drops null-gender and [] leaders; plain list unchanged', async () => {
    const pick = await w.leaderSvc.list(G79, { pick: true });
    expect(pick.map((l) => l.id)).toEqual([w.jg.id]);
    const plain = (await w.leaderSvc.list(G79)).map((l) => l.id);
    expect(plain).toEqual(expect.arrayContaining([w.jg.id, w.ng.id, w.eg.id]));
    expect((await w.leaderSvc.list(ADMIN, { pick: true })).length).toBe(4);
  });
});

describe('F-10 CSV export', () => {
  it('leader login exports only its own rows', async () => {
    const rows = await w.connSvc.exportCsv(A('leader', { leaderId: w.sg.id } as any));
    expect(rows.map((r) => r.leaderName)).toEqual(['Senior Girl Leader']);
  });
  it('quad excludes other grades and genders', async () => {
    const rows = await w.connSvc.exportCsv(G79);
    expect(rows.every((r) => r.studentGrade === 8 && r.studentGender === 'female')).toBe(true);
    expect(rows.length).toBe(2); // s8f via jg and via ng
  });
});

describe('F-50(a) personVisible', () => {
  const row = (gender: string | null) => ({ grade: 8, gender } as any);
  it('unknown gender is hidden from a gender-scoped login, visible to an unscoped one', () => {
    expect(personVisible(G79, row(null), {})).toBe(false);
    expect(personVisible(G79, row('female'), {})).toBe(true);
    expect(personVisible(A('grade', { grades: [8] } as any), row(null), {})).toBe(true);
  });
});
