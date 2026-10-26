// Shared Bus service test setup (pre-flight F14): imported by bus.service.test.ts and the bus consent suites,
// so no suite imports another test file (which would re-run it).
import { makeBusService, type BusCtx } from '../../services/bus.service';
import { InMemoryBusRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemorySettingsRepository, InMemoryConnectionRepository } from '../../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../../core/ministry-config';
import type { Actor } from '../../core/entities/user';
import type { Student } from '../../core/entities/student';
import type { Leader } from '../../core/entities/leader';
import type { RoutingProvider } from '../../services/routing/routing-provider';

export const actor = (role: string, extra: Partial<Actor> = {}): Actor =>
  ({ id: 'u-' + role, role: role as any, displayName: role.toUpperCase(), grade: null as any, quad: null as any, leaderId: null, ...extra });
export const student = (id: string, first: string, last: string, grade: number, gender: 'male' | 'female', mobile: string | null = null): Student => ({
  id, firstName: first, lastName: last, gender, grade, quad: null, mobile, parentPhone: null, dateOfBirth: null,
  svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
  prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
  atRiskStatus: null, dataSource: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
export const leader = (id: string, name: string, gender: 'male' | 'female' | null): Leader => ({
  id, fullName: name, gender, grades: [], active: true, createdByGrade: null, smsTemplate: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
export const FRI_7PM = '2026-10-09T19:00';

export async function setup(opts: { moduleOn?: boolean; routing?: RoutingProvider } = {}) {
  const bus = new InMemoryBusRepository(); const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository(); const settings = new InMemorySettingsRepository();
  await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
  const cfg = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, {
    modules: { busMinistry: opts.moduleOn ?? true, busConsentForm: opts.moduleOn ?? true },
  });
  await settings.updateSettings({ ministryConfig: cfg });
  await students.save(student('s1', 'Jess', 'Tran', 9, 'female', '0412345678'));
  await students.save(student('s2', 'Sam', 'Ode', 8, 'male'));
  await students.save(student('s3', 'Riley', 'Kim', 10, 'male'));
  await leaders.save(leader('L1', 'Tom', 'male'));
  await leaders.save(leader('L2', 'Sarah', 'female'));
  // SY-04: a junior leader's own car takes only its connected students — s1 is Tom's (L1).
  const connections = new InMemoryConnectionRepository(); await connections.init();
  await connections.save({ id: 'c-L1-s1', studentId: 's1', leaderId: 'L1', assignedByRole: 'admin', createdAt: '2026-01-01T00:00:00.000Z' });
  const svc = makeBusService(bus, students, leaders, settings, opts.routing, connections);
  const ctx = (role: string, asLeaderId: string | null = null, localNow = FRI_7PM): BusCtx => ({ actor: actor(role), asLeaderId, localNow });
  return { svc, bus, students, leaders, settings, ctx, connections };
}
