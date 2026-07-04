import { describe, it, expect } from 'vitest';
import { makeOverviewService, invalidateOverviewCache } from '../services/overview.service';
import { makeStudentService } from '../services/student.service';
import {
  InMemoryStudentRepository,
  InMemoryLeaderRepository,
  InMemoryConnectionRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';

function actor(role: string): Actor {
  return { id: 'a-test', role: role as any, displayName: 'T', grade: null as any, quad: null as any };
}

const ADMIN = actor('admin');

async function makeServices() {
  // Module-level response cache keyed by actor — clear it so one test's fresh
  // repos never serve a stale result cached by an earlier test (same ADMIN key).
  invalidateOverviewCache();
  const studentRepo = new InMemoryStudentRepository();
  const leaderRepo = new InMemoryLeaderRepository();
  const connRepo = new InMemoryConnectionRepository();
  await Promise.all([studentRepo.init(), leaderRepo.init(), connRepo.init()]);

  const studentSvc = makeStudentService(studentRepo);
  const overviewSvc = makeOverviewService(studentRepo, leaderRepo, connRepo);

  const s1 = await studentSvc.create(ADMIN, { firstName: 'Alice', lastName: 'Smith', gender: 'female', grade: 9 });
  await studentRepo.save({ ...s1, svcAttended: 1, svcTotal: 1 }); // "attended" so it counts as connectable

  return { studentRepo, leaderRepo, connRepo, overviewSvc, s1 };
}

describe('Overview Service', () => {
  it('reports the ministry total for the seeded student', async () => {
    const { overviewSvc } = await makeServices();
    const stats = await overviewSvc.getStats(ADMIN);
    expect(stats.ministryTotal).toBe(1);
    expect(stats.connectedTotal).toBe(0);
  });

  it('serves a cached result until invalidated, even if the underlying data changes', async () => {
    const { overviewSvc, studentRepo, s1 } = await makeServices();
    const first = await overviewSvc.getStats(ADMIN);
    expect(first.ministryTotal).toBe(1);

    // Add a second connectable student directly via the repo, bypassing any
    // invalidation hook — simulates a write path that forgot to invalidate.
    await studentRepo.save({
      id: 's2', firstName: 'Bob', lastName: 'Jones', gender: 'male', grade: 9,
      quad: null, mobile: null, parentPhone: null, dateOfBirth: null,
      svcAttended: 1, svcTotal: 1, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
      prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
      atRiskStatus: null, dataSource: null,
      createdAt: s1.createdAt, updatedAt: s1.createdAt,
    });

    const second = await overviewSvc.getStats(ADMIN);
    expect(second.ministryTotal).toBe(1); // still cached — proves the cache is active

    invalidateOverviewCache();
    const third = await overviewSvc.getStats(ADMIN);
    expect(third.ministryTotal).toBe(2); // fresh after invalidation
  });
});
