import { describe, it, expect } from 'vitest';
import { makeAtRiskService, computeStatus } from '../services/atrisk.service';
import { makeStudentService } from '../services/student.service';
import { InMemoryStudentRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';

function actor(role: string, opts: { grade?: number; quad?: string } = {}): Actor {
  return { id: 'a-test', role: role as any, displayName: 'T', grade: (opts.grade ?? null) as any, quad: (opts.quad ?? null) as any };
}

const ADMIN = actor('admin');

// Dynamic model (no thresholds): a student is flagged when their attendance
// TREND turns down vs the previous term, or they stop attending entirely.
async function makeServices() {
  const studentRepo = new InMemoryStudentRepository();
  const settingsRepo = new InMemorySettingsRepository();
  await studentRepo.init();
  await settingsRepo.init();
  const studentSvc = makeStudentService(studentRepo);
  const atRiskSvc = makeAtRiskService(studentRepo, settingsRepo);

  const seed = async (
    first: string, last: string, gender: string, grade: number,
    cur: [number, number, number, number],   // svcA, svcT, grpA, grpT
    prev: [number, number, number, number],   // prevSvcA, prevSvcT, prevGrpA, prevGrpT
  ) => {
    const s = await studentSvc.create(ADMIN, { firstName: first, lastName: last, gender: gender as any, grade });
    const full = await studentRepo.findById(s.id);
    if (full) {
      await studentRepo.save({
        ...full,
        svcAttended: cur[0], svcTotal: cur[1], grpAttended: cur[2], grpTotal: cur[3],
        prevSvcAttended: prev[0], prevSvcTotal: prev[1], prevGrpAttended: prev[2], prevGrpTotal: prev[3],
      });
    }
    return s;
  };

  // Alice: attended last term, ZERO this term -> stopped
  const s1 = await seed('Alice', 'Smith', 'female', 9, [0, 8, 0, 6], [6, 8, 4, 6]);
  // Bob: rate collapsed vs last term (87.5% -> 25%) -> declining
  const s2 = await seed('Bob', 'Jones', 'male', 9, [2, 8, 1, 6], [7, 8, 5, 6]);
  // Carol: rate dropped >=20pts (100% -> 62.5%) -> declining
  const s3 = await seed('Carol', 'White', 'female', 10, [5, 8, 4, 6], [8, 8, 6, 6]);
  // Dave: steady high attendance -> regular
  const s4 = await seed('Dave', 'Black', 'male', 10, [7, 8, 5, 6], [7, 8, 5, 6]);

  return { atRiskSvc, studentSvc, studentRepo, settingsRepo, s1, s2, s3, s4 };
}

describe('At-Risk Service — dynamic computation', () => {
  it('TC39: student who attended last term but zero this term = stopped', async () => {
    const { atRiskSvc } = await makeServices();
    const list = await atRiskSvc.list(ADMIN);
    const found = list.find(e => e.fullName === 'Alice Smith');
    expect(found).toBeDefined();
    expect(found?.status).toBe('stopped');
  });

  it('TC40: student whose rate collapsed vs last term = declining', async () => {
    const { atRiskSvc } = await makeServices();
    const list = await atRiskSvc.list(ADMIN);
    const found = list.find(e => e.fullName === 'Bob Jones');
    expect(found).toBeDefined();
    expect(found?.status).toBe('declining');
  });

  it('TC41: student whose rate dropped >=20pts = declining', async () => {
    const { atRiskSvc } = await makeServices();
    const list = await atRiskSvc.list(ADMIN);
    const found = list.find(e => e.fullName === 'Carol White');
    expect(found).toBeDefined();
    expect(found?.status).toBe('declining');
  });

  it('TC42: steady student excluded from at-risk list', async () => {
    const { atRiskSvc } = await makeServices();
    const list = await atRiskSvc.list(ADMIN);
    const found = list.find(e => e.fullName === 'Dave Black');
    expect(found).toBeUndefined();
  });

  it('TC43: recompute updates student atRiskStatus in repo', async () => {
    const { atRiskSvc, studentRepo, s4 } = await makeServices();
    const result = await atRiskSvc.recompute(actor('director'));
    expect(result.updated).toBeGreaterThanOrEqual(0);
    // s4 has steady high attendance — should be regular
    const s = await studentRepo.findById(s4.id);
    expect(s?.atRiskStatus).toBe('regular');
  });

  it('TC44: grade login only sees own grade at-risk', async () => {
    const { atRiskSvc } = await makeServices();
    const list = await atRiskSvc.list(actor('grade', { grade: 9 }));
    expect(list.every(e => e.grade === 9)).toBe(true);
  });

  it('TC45: g79 quad sees only female Yr 7-9 at-risk', async () => {
    const { atRiskSvc } = await makeServices();
    const list = await atRiskSvc.list(actor('quad', { quad: 'g79' }));
    expect(list.every(e => e.gender === 'female' && e.grade !== null && e.grade <= 9)).toBe(true);
  });

  it('TC46: stopped sorted before declining', async () => {
    const { atRiskSvc } = await makeServices();
    const list = await atRiskSvc.list(ADMIN);
    const stoppedIdx = list.findIndex(e => e.status === 'stopped');
    const decliningIdx = list.findIndex(e => e.status === 'declining');
    if (stoppedIdx >= 0 && decliningIdx >= 0) {
      expect(stoppedIdx).toBeLessThan(decliningIdx);
    }
  });
});

describe('computeStatus — dynamic, threshold-free', () => {
  it('attended a group this term -> NOT stopped', () => {
    // svc 0/8, grp 3/6 this term; attended last term too
    expect(computeStatus(0, 8, 3, 6, 4, 8, 2, 6)).not.toBe('stopped');
  });
  it('attended neither stream this term (but did before) -> stopped', () => {
    expect(computeStatus(0, 8, 0, 6, 5, 8, 3, 6)).toBe('stopped');
  });
  it('never engaged (no attendance this OR last term) -> regular, not at risk', () => {
    expect(computeStatus(0, 8, 0, 0, 0, 0, 0, 0)).toBe('regular');
  });
  it('rate dropped >=20pts vs last term -> declining', () => {
    // svc 37.5% this vs 100% last
    expect(computeStatus(3, 8, 4, 6, 8, 8, 5, 6)).toBe('declining');
  });
  it('steady attendance -> regular', () => {
    expect(computeStatus(7, 8, 5, 6, 7, 8, 5, 6)).toBe('regular');
  });
});
