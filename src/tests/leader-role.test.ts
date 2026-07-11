import { describe, it, expect } from 'vitest';
import { can } from '../services/access-control';
import { makeStudentService } from '../services/student.service';
import { makeAtRiskService } from '../services/atrisk.service';
import { makeConnectionService } from '../services/connection.service';
import { makeAccountService } from '../services/account.service';
import {
  InMemoryStudentRepository, InMemoryLeaderRepository,
  InMemoryConnectionRepository, InMemorySettingsRepository, InMemoryUserRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import type { Student } from '../core/entities/student';
import { computeQuad } from '../core/types/enums';
import { ForbiddenError, BadRequestError } from '../core/errors/app-error';

// The `leader` (junior leader) role — §5.2. Read-only, scoped to their OWN
// connected students. These lock in both the permission set and the scope.

const LEADER_ID = 'ldr-1';
const OTHER_LEADER_ID = 'ldr-2';
const leaderActor: Actor = { id: 'u-leader', role: 'leader', displayName: 'JL', grade: null, quad: null, leaderId: LEADER_ID };

let n = 0;
function mkStudent(grade: number, gender: 'male' | 'female'): Student {
  const now = new Date().toISOString();
  return {
    id: 's' + n++, firstName: 'F' + n, lastName: 'L' + n, gender, grade, quad: computeQuad(grade, gender),
    mobile: '0400000000', parentPhone: null, dateOfBirth: null,
    svcAttended: 0, svcTotal: 1, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
    prevSvcAttended: 1, prevSvcTotal: 1, prevGrpAttended: 0, prevGrpTotal: 0,
    atRiskStatus: 'stopped', dataSource: 'test', createdAt: now, updatedAt: now,
  };
}

async function harness() {
  const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository();
  const conns = new InMemoryConnectionRepository();
  const settings = new InMemorySettingsRepository();
  await Promise.all([students.init(), leaders.init(), conns.init(), settings.init()]);
  const now = new Date().toISOString();
  await leaders.save({ id: LEADER_ID, fullName: 'My Leader', gender: 'female', grades: [9], active: true, createdByGrade: null, smsTemplate: null, createdAt: now, updatedAt: now });
  await leaders.save({ id: OTHER_LEADER_ID, fullName: 'Other Leader', gender: 'male', grades: [9], active: true, createdByGrade: null, smsTemplate: null, createdAt: now, updatedAt: now });
  const mine1 = mkStudent(9, 'female'); const mine2 = mkStudent(8, 'female');
  const theirs = mkStudent(9, 'male'); const unconnected = mkStudent(7, 'male');
  for (const s of [mine1, mine2, theirs, unconnected]) await students.save(s);
  await conns.save({ id: 'c1', studentId: mine1.id, leaderId: LEADER_ID, assignedByRole: 'admin', createdAt: now });
  await conns.save({ id: 'c2', studentId: mine2.id, leaderId: LEADER_ID, assignedByRole: 'admin', createdAt: now });
  await conns.save({ id: 'c3', studentId: theirs.id, leaderId: OTHER_LEADER_ID, assignedByRole: 'admin', createdAt: now });
  return {
    students, leaders, conns, settings, mine1, mine2, theirs, unconnected,
    studentSvc: makeStudentService(students, settings, conns),
    atriskSvc: makeAtRiskService(students, settings, conns),
    connSvc: makeConnectionService(conns, students, leaders, settings),
  };
}

describe('leader permissions', () => {
  it('is read-only and scoped: has read, lacks write/import/admin/overview', () => {
    expect(can(leaderActor, 'student:read')).toBe(true);
    expect(can(leaderActor, 'student:read:sensitive')).toBe(true);
    expect(can(leaderActor, 'atrisk:read')).toBe(true);
    expect(can(leaderActor, 'leader:read')).toBe(true);
    expect(can(leaderActor, 'connection:write')).toBe(false);
    expect(can(leaderActor, 'leader:write')).toBe(false);
    expect(can(leaderActor, 'overview:read')).toBe(false);
    expect(can(leaderActor, 'import:run')).toBe(false);
    expect(can(leaderActor, 'admin:manage')).toBe(false);
  });
});

describe('leader student scope (own connections only)', () => {
  it('student.list returns only their 2 connected students', async () => {
    const h = await harness();
    const list = await h.studentSvc.list(leaderActor);
    expect(list.map((s) => s.id).sort()).toEqual([h.mine1.id, h.mine2.id].sort());
  });
  it('student.get allows a connected student, 404s an unconnected one', async () => {
    const h = await harness();
    expect((await h.studentSvc.get(leaderActor, h.mine1.id)).id).toBe(h.mine1.id);
    await expect(h.studentSvc.get(leaderActor, h.theirs.id)).rejects.toThrow();
    await expect(h.studentSvc.get(leaderActor, h.unconnected.id)).rejects.toThrow();
  });
  it('student.search is scoped to their students', async () => {
    const h = await harness();
    const res = await h.studentSvc.search(leaderActor, 'F'); // matches all first names
    expect(res.every((s) => [h.mine1.id, h.mine2.id].includes(s.id))).toBe(true);
  });
  it('atrisk.list returns only their at-risk students', async () => {
    const h = await harness();
    const entries = await h.atriskSvc.list(leaderActor);
    expect(entries.map((e) => e.studentId).sort()).toEqual([h.mine1.id, h.mine2.id].sort());
  });
});

describe('leader connection scope', () => {
  it('connection.listAll returns only their connections', async () => {
    const h = await harness();
    const all = await h.connSvc.listAll(leaderActor);
    expect(all.every((c) => c.leaderId === LEADER_ID)).toBe(true);
    expect(all.length).toBe(2);
  });
  it('listByLeader rejects another leader’s id', async () => {
    const h = await harness();
    expect((await h.connSvc.listByLeader(leaderActor, LEADER_ID)).length).toBe(2);
    await expect(h.connSvc.listByLeader(leaderActor, OTHER_LEADER_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('listByStudent rejects a student the leader is not connected to', async () => {
    const h = await harness();
    expect((await h.connSvc.listByStudent(leaderActor, h.mine1.id)).length).toBeGreaterThan(0);
    await expect(h.connSvc.listByStudent(leaderActor, h.theirs.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('account.service — leader accounts require a linked leader record', () => {
  const admin: Actor = { id: 'adm', role: 'admin', displayName: 'A', grade: null, quad: null };
  async function accountSvc() {
    const users = new InMemoryUserRepository();
    await users.init();
    return { users, account: makeAccountService(users) };
  }
  it('rejects a leader account without leaderId', async () => {
    const { account } = await accountSvc();
    await expect(account.create(admin, {
      displayName: 'JL', email: 'jl', password: 'longenoughpw', role: 'leader',
    })).rejects.toBeInstanceOf(BadRequestError);
  });
  it('creates a leader account bound to a leader record', async () => {
    const { users, account } = await accountSvc();
    const created = await account.create(admin, {
      displayName: 'JL', email: 'jl', password: 'longenoughpw', role: 'leader', leaderId: LEADER_ID,
    });
    const stored = await users.findById(created.id);
    expect(stored?.role).toBe('leader');
    expect(stored?.leaderId).toBe(LEADER_ID);
  });
});
