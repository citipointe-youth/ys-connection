import { makeBusService, type BusCtx } from '../../services/bus.service';
import { InMemoryBusRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemorySettingsRepository } from '../../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../../core/ministry-config';
import { FakeRoutingProvider } from '../../services/routing/fake-routing-provider';
import type { RoutingProvider, SolveProblem, MapPath, MapMarker, RoutePoint } from '../../services/routing/routing-provider';
import type { Actor } from '../../core/entities/user';
import type { Student } from '../../core/entities/student';
import type { Leader } from '../../core/entities/leader';

export const FRI_7PM = '2026-10-09T19:00';
const T = '2026-01-01T00:00:00.000Z';

/** Wraps a provider (default: fake) and records exactly what would be sent to Google. */
export function recordingRouting(inner: RoutingProvider = new FakeRoutingProvider()) {
  const calls = { solve: [] as SolveProblem[], autocomplete: [] as { input: string; session: string; region: string }[],
    matrix: 0, matrixCalls: [] as { from: RoutePoint; to: RoutePoint }[][], map: [] as { paths: MapPath[]; markers: MapMarker[] }[] };
  const provider: RoutingProvider = {
    name: 'fake',
    solve: (p, s) => { calls.solve.push(p); return inner.solve(p, s); },
    autocomplete: (i, t, r, s) => { calls.autocomplete.push({ input: i, session: t, region: r }); return inner.autocomplete(i, t, r, s); },
    matrix: (pairs, s) => { calls.matrix++; calls.matrixCalls.push(pairs); return inner.matrix(pairs, s); },
    staticMap: (paths, markers, s) => { calls.map.push({ paths, markers }); return inner.staticMap(paths, markers, s); },
  };
  return { provider, calls };
}

/** Fake provider with some methods replaced. */
export function stubRouting(over: Partial<Pick<RoutingProvider, 'solve' | 'autocomplete' | 'matrix' | 'staticMap'>>): RoutingProvider {
  const f = new FakeRoutingProvider();
  return {
    name: 'fake',
    solve: over.solve ?? ((p, s) => f.solve(p, s)),
    autocomplete: over.autocomplete ?? ((a, b, c, s) => f.autocomplete(a, b, c, s)),
    matrix: over.matrix ?? ((p, s) => f.matrix(p, s)),
    staticMap: over.staticMap ?? ((p, m, s) => f.staticMap(p, m, s)),
  };
}

const student = (id: string, first: string, last: string, grade: number, gender: 'male' | 'female', mobile: string | null = null): Student => ({
  id, firstName: first, lastName: last, gender, grade, quad: null, mobile, parentPhone: null, dateOfBirth: null,
  svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
  prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
  atRiskStatus: null, dataSource: null, createdAt: T, updatedAt: T,
});
const leader = (id: string, name: string, gender: 'male' | 'female' | null): Leader => ({
  id, fullName: name, gender, grades: [], active: true, createdByGrade: null, smsTemplate: null, createdAt: T, updatedAt: T,
});

export async function busFixture(opts: { routing?: RoutingProvider; churchPlaceId?: string } = {}) {
  const bus = new InMemoryBusRepository(); const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository(); const settings = new InMemorySettingsRepository();
  await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
  await settings.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, {
    modules: { busMinistry: true },
    busMinistry: { visibility: 'all', churchAddress: '1 Church St, Testville', churchPlaceId: opts.churchPlaceId ?? 'fake:church', regionCode: 'au' },
  }) });
  await students.save(student('s1', 'Jess', 'Tran', 9, 'female', '0412345678'));
  await students.save(student('s2', 'Sam', 'Ode', 8, 'male', '0499888777'));
  await students.save(student('s3', 'Riley', 'Kim', 10, 'male'));
  await students.save(student('s4', 'Mia', 'Lee', 9, 'female'));
  await leaders.save(leader('L1', 'Tom', 'male'));
  await leaders.save(leader('L2', 'Sarah', 'female'));
  await leaders.save(leader('L3', 'Amy', 'female'));
  await leaders.save(leader('L4', 'Ben', 'male'));
  const svc = makeBusService(bus, students, leaders, settings, opts.routing ?? new FakeRoutingProvider());
  const ctx = (role: string, asLeaderId: string | null = null): BusCtx => ({
    actor: { id: 'u-' + role, role, displayName: role.toUpperCase(), grade: null, quad: null, leaderId: null } as unknown as Actor,
    asLeaderId, localNow: FRI_7PM });
  const admin = ctx('admin');
  /** A fleet vehicle running tonight with these leaders. Returns the run-vehicle id. */
  async function car(name: string, seats: number, leaderIds: string[],
    extra: { prefGrades?: number[]; endsAt?: 'church' | 'last_drop' | 'address' } = {}): Promise<string> {
    const v = await svc.saveVehicle(admin, { name, seats, prefGrades: extra.prefGrades ?? [], endsAt: extra.endsAt ?? 'church' });
    const rv = (await svc.getRun(admin)).vehicles.find((x) => x.vehicleId === v.id)!;
    await svc.updateRunVehicle(admin, rv.id, { leaderIds });
    return rv.id;
  }
  async function rider(studentId: string, placeId: string | null = `fake:${studentId}`) {
    return svc.addRider(admin, { studentId, newAddress: { label: 'Home', address: `${studentId} Test St, Testville`, placeId } });
  }
  return { svc, bus, students, leaders, settings, ctx, admin, car, rider };
}
