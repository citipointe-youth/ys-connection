import { describe, it, expect, beforeEach } from 'vitest';
import { makeAllocationService } from '../services/allocation.service';
import { makeStudentService } from '../services/student.service';
import { makeLeaderService } from '../services/leader.service';
import {
  InMemoryStudentRepository,
  InMemoryLeaderRepository,
  InMemoryAllocationRepository,
  InMemorySettingsRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { BadRequestError, ForbiddenError, ConflictError } from '../core/errors/app-error';

function actor(role: string, opts: { grade?: number; quad?: string } = {}): Actor {
  return { id: 'a-test', role: role as any, displayName: 'Test', grade: (opts.grade ?? null) as any, quad: (opts.quad ?? null) as any };
}

const ADMIN = actor('admin');
const GRADE9 = actor('grade', { grade: 9 });
const G79 = actor('quad', { quad: 'g79' });

async function buildServices() {
  const studentRepo = new InMemoryStudentRepository();
  const leaderRepo = new InMemoryLeaderRepository();
  const allocRepo = new InMemoryAllocationRepository();
  const settingsRepo = new InMemorySettingsRepository();
  await studentRepo.init();
  await leaderRepo.init();
  await allocRepo.init();
  await settingsRepo.init();

  const studentSvc = makeStudentService(studentRepo);
  const leaderSvc = makeLeaderService(leaderRepo);
  const allocSvc = makeAllocationService(allocRepo, studentRepo, leaderRepo, settingsRepo);

  // Seed a student in grade 9 female
  const student = await studentSvc.create(ADMIN, {
    firstName: 'Alice', lastName: 'Smith', gender: 'female', grade: 9,
  });
  // Seed a student in grade 8 female (for cross-grade test)
  const student2 = await studentSvc.create(ADMIN, {
    firstName: 'Beth', lastName: 'Jones', gender: 'female', grade: 8,
  });
  // Seed a student grade 9 male
  const student3 = await studentSvc.create(ADMIN, {
    firstName: 'Carlos', lastName: 'Lee', gender: 'male', grade: 9,
  });
  // Seed a female leader
  const leaderF = await leaderSvc.create(ADMIN, {
    fullName: 'Emma Leader', gender: 'female', grades: [9],
  });
  // Seed a male leader
  const leaderM = await leaderSvc.create(ADMIN, {
    fullName: 'James Leader', gender: 'male', grades: [9],
  });

  return { studentSvc, leaderSvc, allocSvc, student, student2, student3, leaderF, leaderM };
}

describe('Allocation Service', () => {
  // TC23 — admin can allocate any student to any leader
  it('TC23: admin can allocate', async () => {
    const { allocSvc, student, leaderF } = await buildServices();
    const alloc = await allocSvc.assign(ADMIN, { studentId: student.id, leaderId: leaderF.id });
    expect(alloc.studentId).toBe(student.id);
    expect(alloc.leaderId).toBe(leaderF.id);
  });

  // TC24 — grade login can allocate own-grade student to same-gender leader
  it('TC24: grade can allocate own-grade student', async () => {
    const { allocSvc, student, leaderF } = await buildServices();
    const alloc = await allocSvc.assign(GRADE9, { studentId: student.id, leaderId: leaderF.id });
    expect(alloc).toBeDefined();
  });

  // TC25 — cross-grade allocation allowed when genders match
  it('TC25: grade can cross-grade allocate when genders match', async () => {
    const { allocSvc, student2, leaderF } = await buildServices();
    // student2 is grade 8 female, leaderF is female — grade 9 login doing cross-grade
    const alloc = await allocSvc.assign(GRADE9, { studentId: student2.id, leaderId: leaderF.id });
    expect(alloc).toBeDefined();
  });

  // TC26 — cross-grade allocation rejected when genders mismatch
  it('TC26: cross-grade fails when genders mismatch', async () => {
    const { allocSvc, student2, leaderM } = await buildServices();
    // student2 female, leaderM male — cross-grade should fail
    await expect(allocSvc.assign(GRADE9, { studentId: student2.id, leaderId: leaderM.id }))
      .rejects.toThrow(BadRequestError);
  });

  // TC27 — duplicate allocation is rejected
  it('TC27: duplicate allocation rejected', async () => {
    const { allocSvc, student, leaderF } = await buildServices();
    await allocSvc.assign(ADMIN, { studentId: student.id, leaderId: leaderF.id });
    await expect(allocSvc.assign(ADMIN, { studentId: student.id, leaderId: leaderF.id }))
      .rejects.toThrow(ConflictError);
  });

  // TC28 — unassign removes allocation
  it('TC28: unassign removes allocation', async () => {
    const { allocSvc, student, leaderF } = await buildServices();
    await allocSvc.assign(ADMIN, { studentId: student.id, leaderId: leaderF.id });
    await allocSvc.unassign(ADMIN, student.id, leaderF.id);
    const remaining = await allocSvc.listByStudent(ADMIN, student.id);
    expect(remaining).toHaveLength(0);
  });

  // TC29 — quad login cannot write allocations (no allocation:write)
  // Note: quad DOES have allocation:write per spec, so this should succeed
  it('TC29: quad can allocate students in their scope', async () => {
    const { allocSvc, student, leaderF } = await buildServices();
    // student is female grade 9 — in g79 scope? No — g79 is grades 7-9. Let's verify.
    const alloc = await allocSvc.assign(G79, { studentId: student.id, leaderId: leaderF.id });
    expect(alloc).toBeDefined();
  });

  // TC30 — leader summary returns correct students
  it('TC30: leaderSummary returns assigned students', async () => {
    const { allocSvc, student, student3, leaderF, leaderM } = await buildServices();
    await allocSvc.assign(ADMIN, { studentId: student.id, leaderId: leaderF.id });
    await allocSvc.assign(ADMIN, { studentId: student3.id, leaderId: leaderM.id });
    const summary = await allocSvc.leaderSummary(ADMIN, leaderF.id);
    expect(summary.students).toHaveLength(1);
    expect(summary.students[0]?.fullName).toBe('Alice Smith');
  });
});
