import { describe, it, expect } from 'vitest';
import { makeConnectionAuditService } from '../services/connection-audit.service';
import { saturdayOf } from '../services/terms';
import {
  InMemoryConnectionAuditRepository,
  InMemorySettingsRepository,
  InMemoryStudentRepository,
  InMemoryServiceSessionRepository,
  InMemoryServiceAttendanceRepository,
  InMemoryLifegroupRepository,
  InMemoryLifegroupWeekRepository,
  InMemoryLifegroupAttendanceRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { ForbiddenError } from '../core/errors/app-error';

function actor(role: string): Actor {
  return { id: 'a', role: role as any, displayName: 'T', grade: null as any, quad: null as any };
}

async function buildRepos() {
  const repo = new InMemoryConnectionAuditRepository();
  const settings = new InMemorySettingsRepository();
  const students = new InMemoryStudentRepository();
  const sessions = new InMemoryServiceSessionRepository();
  const serviceAttendance = new InMemoryServiceAttendanceRepository();
  const lifegroups = new InMemoryLifegroupRepository();
  const lifegroupWeeks = new InMemoryLifegroupWeekRepository();
  const lifegroupAttendance = new InMemoryLifegroupAttendanceRepository();
  await Promise.all([
    repo.init(), settings.init(), students.init(), sessions.init(),
    serviceAttendance.init(), lifegroups.init(), lifegroupWeeks.init(), lifegroupAttendance.init(),
  ]);
  await settings.updateSettings({ serviceMinAttendance: 1 }); // tiny test data
  const service = makeConnectionAuditService(
    repo, settings, students, sessions, serviceAttendance,
    lifegroups, lifegroupWeeks, lifegroupAttendance,
  );
  return { service, repo, settings, students, sessions, serviceAttendance, lifegroups, lifegroupWeeks, lifegroupAttendance };
}

async function svc() {
  return (await buildRepos()).service;
}

// A minimal YTD service upload: 3 Fridays, two in Term 1 and one after a gap in
// Term 2, plus one student attending all three. Group/CRM uploads empty.
function uploadPayload() {
  return {
    service: {
      rows: [
        { first_name: 'Ava', last_name: 'Okafor', gender: 'female', grade: 9,
          '2026-02-06': 'Y', '2026-02-13': 'Y', '2026-04-24': 'Y' },
      ],
    },
    group: { groups: [] },
    team: [], connect: [], decision: [], flows: [],
  };
}

describe('ConnectionAuditService', () => {
  it('rejects non-director/admin upload', async () => {
    const s = await svc();
    await expect(s.upload(actor('grade'), uploadPayload())).rejects.toThrow(ForbiddenError);
  });

  it('director upload computes terms and stores one row per year', async () => {
    const s = await svc();
    const a = await s.upload(actor('director'), uploadPayload());
    expect(a.year).toBe(2026);
    expect(a.id).toBe('2026');
    expect(a.snapshot.terms.map((t) => t.key)).toEqual(['2026-T1', '2026-T2']);
    // The latest term is flagged in progress (mid-term / YTD).
    expect(a.snapshot.perTerm['2026-T2']!.inProgress).toBe(true);
    expect(a.snapshot.perTerm['2026-T1']!.inProgress).toBe(false);
    // Ava attended both T1 services and the single T2 service.
    const ava = a.snapshot.students[0]!;
    expect(a.snapshot.perTerm['2026-T1']!.byStudent[ava.id]!.svcAttended).toBe(2);
    expect(a.snapshot.perTerm['2026-T2']!.byStudent[ava.id]!.svcAttended).toBe(1);
    const list = await s.list(actor('admin'));
    expect(list).toHaveLength(1);
    expect(list[0]!.year).toBe(2026);
  });

  it('re-upload overwrites the same year (latest-per-year)', async () => {
    const s = await svc();
    await s.upload(actor('director'), uploadPayload());
    await s.upload(actor('director'), uploadPayload());
    const list = await s.list(actor('admin'));
    expect(list).toHaveLength(1);
  });

  it('get returns the stored audit; remove deletes it', async () => {
    const s = await svc();
    await s.upload(actor('director'), uploadPayload());
    expect(await s.get(actor('admin'), 2026)).not.toBeNull();
    await s.remove(actor('admin'), 2026);
    expect(await s.get(actor('admin'), 2026)).toBeNull();
  });
});

describe('ConnectionAuditService.finalizeFromLive', () => {
  const now = '2026-01-01T00:00:00.000Z';

  it('builds a snapshot straight from live tables, incl. named-lifegroup roster', async () => {
    const { service, students, sessions, serviceAttendance, lifegroups, lifegroupWeeks, lifegroupAttendance } = await buildRepos();

    const ava = await students.save({
      id: 'S1', firstName: 'Ava', lastName: 'Okafor', gender: 'female', grade: 9, quad: 'g79',
      mobile: null, parentPhone: null, dateOfBirth: null,
      svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
      prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
      atRiskStatus: 'new', dataSource: null, createdAt: now, updatedAt: now,
    } as any);

    // Two Fridays in T1, one (after a >14-day gap) in T2 — same split as the CSV test.
    const s1 = await sessions.save({ id: 'SS1', importId: null, sessionDate: '2026-02-06', sessionName: 'F1', isRegular: true, isValid: true, totalAttendance: 1, sortOrder: 0, createdAt: now } as any);
    const s2 = await sessions.save({ id: 'SS2', importId: null, sessionDate: '2026-02-13', sessionName: 'F2', isRegular: true, isValid: true, totalAttendance: 1, sortOrder: 1, createdAt: now } as any);
    const s3 = await sessions.save({ id: 'SS3', importId: null, sessionDate: '2026-04-24', sessionName: 'F3', isRegular: true, isValid: true, totalAttendance: 1, sortOrder: 2, createdAt: now } as any);
    await serviceAttendance.saveMany([
      { studentId: ava.id, sessionId: s1.id, attended: true },
      { studentId: ava.id, sessionId: s2.id, attended: true },
      { studentId: ava.id, sessionId: s3.id, attended: true },
    ]);

    const lg = await lifegroups.save({ id: 'LG1', fullName: 'Grade 9 Girls Lifegroup', shortName: 'G9 Girls', grade: 9, gender: 'female', createdAt: now } as any);
    const w1 = await lifegroupWeeks.save({ id: 'W1', importId: null, weekNum: 1, weekKey: 'k1', weekStart: saturdayOf('2026-02-06'), weekEnd: null } as any);
    const w2 = await lifegroupWeeks.save({ id: 'W2', importId: null, weekNum: 2, weekKey: 'k2', weekStart: saturdayOf('2026-04-24'), weekEnd: null } as any);
    await lifegroupAttendance.saveMany([
      { studentId: ava.id, weekId: w1.id, lifegroupId: lg.id, groupMet: true, attended: true },
      { studentId: ava.id, weekId: w2.id, lifegroupId: lg.id, groupMet: true, attended: false },
    ]);

    const audit = await service.finalizeFromLive(actor('admin'));
    expect(audit.year).toBe(2026);
    expect(audit.snapshot.terms.map((t) => t.key)).toEqual(['2026-T1', '2026-T2']);
    expect(audit.snapshot.students).toHaveLength(1);
    expect(audit.snapshot.perTerm['2026-T1']!.byStudent[ava.id]!.svcAttended).toBe(2);
    expect(audit.snapshot.perTerm['2026-T2']!.byStudent[ava.id]!.svcAttended).toBe(1);
    // No CRM overlays for a live-finalized snapshot.
    expect(audit.snapshot.uploads.team).toEqual([]);

    const t1 = audit.snapshot.lgStatsByTerm['2026-T1']!;
    expect(t1).toHaveLength(1);
    expect(t1[0]).toMatchObject({ lifegroupId: 'LG1', name: 'Grade 9 Girls Lifegroup', grade: 9, gender: 'female', quad: 'g79', uniqueAttenders: 1 });
    expect(t1[0]!.roster).toEqual([{ firstName: 'Ava', lastName: 'Okafor', attended: 1, total: 1 }]);

    const t2 = audit.snapshot.lgStatsByTerm['2026-T2']!;
    expect(t2[0]!.roster).toEqual([{ firstName: 'Ava', lastName: 'Okafor', attended: 0, total: 1 }]);
  });

  it('rejects non-director/admin', async () => {
    const { service } = await buildRepos();
    await expect(service.finalizeFromLive(actor('grade'))).rejects.toThrow(ForbiddenError);
  });

  it('throws BadRequestError when there is no valid service data yet', async () => {
    const { service } = await buildRepos();
    await expect(service.finalizeFromLive(actor('admin'))).rejects.toThrow('No valid services found');
  });
});
