// R1 (LINK_REV 6): DO NOT CONTACT phone strip on every student-shaped endpoint.
import { describe, it, expect, vi } from 'vitest';
import { makeDnc } from '../services/dnc';
import { makeStudentService } from '../services/student.service';
import { makeConnectionService } from '../services/connection.service';
import { makeFollowupService } from '../services/followup.service';
import { makeAtRiskService } from '../services/atrisk.service';
import { makeBusService, type BusCtx } from '../services/bus.service';
import {
  InMemoryStudentRepository, InMemoryConnectionRepository, InMemoryLeaderRepository, InMemorySettingsRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository, InMemoryLifegroupWeekRepository,
  InMemoryLifegroupAttendanceRepository, InMemoryBusRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { Student } from '../core/entities/student';
import type { LinkRosterRow } from '../core/link-types';

const T0 = '2026-01-01T00:00:00.000Z';
const student = (id: string, first: string): Student => ({
  id, firstName: first, lastName: 'Test', gender: 'female', grade: 9, quad: 'g79',
  mobile: `04000000${id.slice(-2)}`, parentPhone: `04111111${id.slice(-2)}`, dateOfBirth: null,
  svcAttended: 0, svcTotal: 4, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
  prevSvcAttended: 3, prevSvcTotal: 4, prevGrpAttended: 0, prevGrpTotal: 0, // "stopped" + follow-up eligible
  atRiskStatus: 'stopped', dataSource: null, createdAt: T0, updatedAt: T0,
});
// sC/sA = DNC ('contact'/'all'); sK = 'ok'; sU = no roster row; sI = inactive 'all' row (still DNC: resilience H3); sN = 'unknown'.
const IDS = ['sC01', 'sA02', 'sK03', 'sU04', 'sI05', 'sN06'];
const DNC_IDS = new Set(['sC01', 'sA02', 'sI05']);
const row = (studentId: string, consent: LinkRosterRow['consent'], active = true): LinkRosterRow => ({
  personId: 'p-' + studentId, firstName: 'X', lastName: 'Y', gender: 'female', grade: 9, kind: 'student', active,
  studentId, match: 'auto', updatedAt: T0, consent,
});
const ROSTER: LinkRosterRow[] = [
  row('sC01', 'contact'), row('sA02', 'all'), row('sK03', 'ok'), row('sI05', 'all', false), row('sN06', 'unknown'),
];

const actor = (role: string): Actor => ({
  id: 'u-' + role, role: role as any, displayName: role, grade: 9 as any, quad: role === 'quad' ? 'g79' as any : null,
  gender: 'female', leaderId: role === 'leader' ? 'L1' : null,
} as Actor);
const STRIPPED = ['leader', 'grade', 'quad'];
const KEEP = ['admin', 'director'];

/** Every DNC student has dnc true and (non-admin) no phones; every other student is untouched. */
function expectStrip(role: string, items: { id: string; dnc: boolean; mobile?: string | null; parentPhone?: string | null }[], phones: ('mobile' | 'parentPhone')[] = ['mobile', 'parentPhone']) {
  expect(items.map((i) => i.id).sort()).toEqual([...IDS].sort()); // nobody is dropped
  for (const i of items) {
    const dnc = DNC_IDS.has(i.id);
    expect(i.dnc, `${role} ${i.id} dnc`).toBe(dnc);
    for (const p of phones) {
      if (dnc && STRIPPED.includes(role)) expect(i[p], `${role} ${i.id} ${p}`).toBeNull();
      else expect(i[p], `${role} ${i.id} ${p}`).toMatch(/^04/);
    }
  }
}

async function world() {
  const students = new InMemoryStudentRepository(); const conns = new InMemoryConnectionRepository();
  const leaders = new InMemoryLeaderRepository(); const settings = new InMemorySettingsRepository();
  await Promise.all([students.init(), conns.init(), leaders.init(), settings.init()]);
  await leaders.save({ id: 'L1', fullName: 'Em Leader', gender: 'female', grades: [9], active: true, createdByGrade: null, smsTemplate: null, createdAt: T0, updatedAt: T0 } as any);
  for (const [n, id] of IDS.entries()) {
    await students.save(student(id, 'Kid' + n));
    await conns.save({ id: 'c' + id, studentId: id, leaderId: 'L1', assignedByRole: 'admin', createdAt: T0 });
  }
  const dnc = makeDnc({ roster: async () => ROSTER });
  return { students, conns, leaders, settings, dnc };
}

describe('R1 DNC strip: student.service', () => {
  for (const role of [...STRIPPED, ...KEEP]) {
    it(`list / get for ${role}`, async () => {
      const w = await world();
      const svc = makeStudentService(w.students, w.settings, w.conns, undefined, w.dnc);
      expectStrip(role, await svc.list(actor(role)));
      expectStrip(role, await Promise.all(IDS.map((id) => svc.get(actor(role), id))));
    });
  }
  it('no link wired = nobody is DNC', async () => {
    const w = await world();
    const out = await makeStudentService(w.students, w.settings, w.conns).list(actor('grade'));
    expect(out.every((s) => s.dnc === false && s.mobile)).toBe(true);
  });
});

describe('R1 DNC strip: connection.service', () => {
  for (const role of [...STRIPPED, ...KEEP]) {
    it(`leaderSummary (My students) + exportCsv for ${role}`, async () => {
      const w = await world();
      const svc = makeConnectionService(w.conns, w.students, w.leaders, w.settings, w.dnc);
      expectStrip(role, (await svc.leaderSummary(actor(role), 'L1')).students);
      const rows = await svc.exportCsv(actor(role));
      // export rows carry the student name, not id: map back through the fixture names
      const byName = new Map(IDS.map((id, n) => [`Kid${n} Test`, id]));
      expectStrip(role, rows.map((r) => ({ ...r, id: byName.get(r.studentName)! })));
    });
  }
});

describe('R1 DNC strip: followup.service (Home follow-up)', () => {
  for (const role of [...STRIPPED, ...KEEP]) {
    it(`notSeenService for ${role}`, async () => {
      const w = await world();
      const sessions = new InMemoryServiceSessionRepository(); const att = new InMemoryServiceAttendanceRepository();
      const weeks = new InMemoryLifegroupWeekRepository(); const grp = new InMemoryLifegroupAttendanceRepository();
      for (const r of [sessions, att, weeks, grp]) await r.init();
      await sessions.save({ id: 'SS1', importId: 'i', sessionDate: '2026-06-12', sessionName: 'x', isRegular: true, isValid: true, totalAttendance: 200, sortOrder: 0, createdAt: T0 } as any);
      const svc = makeFollowupService(w.conns, w.students, w.leaders, sessions, att, weeks, grp, w.dnc);
      expectStrip(role, (await svc.leaderFollowup(actor(role), 'L1')).notSeenService);
    });
  }
});

describe('R1 DNC strip: atrisk.service (Health)', () => {
  for (const role of [...STRIPPED, ...KEEP]) {
    it(`list marks DNC students and still lists them for ${role}`, async () => {
      const w = await world();
      const out = await makeAtRiskService(w.students, w.settings, w.conns, w.dnc).list(actor(role));
      expectStrip(role, out.map((e) => ({ ...e, id: e.studentId })), []); // Health carries no phones
    });
  }
});

describe('R1 DNC strip: bus My car', () => {
  it('stop mobiles are stripped for non-admin, kept for admin/director', async () => {
    const w = await world();
    const bus = new InMemoryBusRepository(); await bus.init();
    await w.settings.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { busMinistry: true } }) });
    const svc = makeBusService(bus, w.students, w.leaders, w.settings, undefined, w.conns, w.dnc);
    const ctx = (role: string): BusCtx => ({ actor: actor(role), asLeaderId: 'L1', localNow: '2026-10-09T19:00' });
    const car = await svc.saveVehicle(ctx('admin'), { name: 'Big Bus', seats: 8, endsAt: 'church' });
    const rvId = (await svc.getRun(ctx('admin'))).vehicles.find((v) => v.vehicleId === car.id)!.id;
    await svc.updateRunVehicle(ctx('admin'), rvId, { leaderIds: ['L1'] });
    for (const id of IDS) {
      const r = await svc.addRider(ctx('admin'), { studentId: id, newAddress: { address: `1 ${id} St, Carina`, placeId: `fake:${id}` } });
      await svc.moveRider(ctx('admin'), r.id, { runVehicleId: rvId });
    }
    for (const role of [...STRIPPED, ...KEEP]) {
      const stops = (await svc.myCar(ctx(role))).stops;
      expectStrip(role, stops.map((s) => ({ ...s, id: s.studentId! })), ['mobile']);
    }
  });
});

describe('R1 makeDnc cache', () => {
  it('reads the roster once per 60 s (in-flight shared), then again', async () => {
    vi.useFakeTimers();
    try {
      const roster = vi.fn(async () => ROSTER);
      const dnc = makeDnc({ roster });
      await Promise.all([dnc.forActor(actor('grade')), dnc.forActor(actor('admin'))]);
      expect(roster).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(61_000);
      await dnc.forActor(actor('grade'));
      expect(roster).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('a failed roster read fails closed and is not cached', async () => {
    let fail = true;
    const dnc = makeDnc({ roster: async () => { if (fail) throw new Error('db down'); return ROSTER; } });
    await expect(dnc.forActor(actor('grade'))).rejects.toThrow('db down');
    fail = false;
    const mark = await dnc.forActor(actor('grade'));
    expect(mark({ mobile: '0400' }, 'sC01')).toEqual({ mobile: null, dnc: true });
  });
});

describe('R1 review H1: the unused PATCH /students/:id/at-risk is gone', () => {
  it('no route writes a student except the admin/director student:write ones', async () => {
    const { buildContainer } = await import('../container');
    const { buildRoutes } = await import('../api/http/router');
    const { services } = await buildContainer();
    const writes = buildRoutes(services).filter((r) => r.method !== 'GET' && /^\/students\//.test(r.path)).map((r) => `${r.method} ${r.path}`);
    // It returned the raw Student (DNC phones included) to leader/grade/quad with no scope check.
    expect(writes).not.toContain('PATCH /students/:id/at-risk');
    expect(writes.sort()).toEqual(['DELETE /students/:id', 'PATCH /students/:id']);
  });
});

describe('resilience H3: a known DO NOT CONTACT is sticky', () => {
  it('stickyConsent: only a readable flag replaces a known DNC', async () => {
    const { stickyConsent } = await import('../core/link-contract');
    expect(stickyConsent('contact', 'unknown')).toBe('contact');
    expect(stickyConsent('all', undefined)).toBe('all');
    expect(stickyConsent('contact', 'ok')).toBe('ok');
    expect(stickyConsent('ok', 'unknown')).toBe('unknown');
    expect(stickyConsent(null, 'contact')).toBe('contact');
  });
  it('the in-memory roster push keeps a DNC through an unknown read and clears it on ok', async () => {
    const { InMemoryLinkRepository } = await import('../repositories/in-memory/link.repository');
    const repo = new InMemoryLinkRepository();
    const push = (consent: any, t: string) => repo.replaceMirror('roster', [{ personId: 'p1', firstName: 'A', lastName: 'B', gender: 'female', grade: 9, kind: 'student', consent }], { takenAt: t, consoleId: 'c1' });
    await push('contact', '2026-10-15T01:00:00.000Z');
    await push('unknown', '2026-10-15T02:00:00.000Z');
    expect((await repo.roster())[0]!.consent).toBe('contact');
    await push(undefined, '2026-10-15T03:00:00.000Z');
    expect((await repo.roster())[0]!.consent).toBe('contact');
    await push('ok', '2026-10-15T04:00:00.000Z');
    expect((await repo.roster())[0]!.consent).toBe('ok');
  });
});
