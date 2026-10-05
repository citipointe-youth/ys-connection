import { describe, it, expect } from 'vitest';
import { makeBusService, type BusCtx } from '../services/bus.service';
import { InMemoryBusRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { Student } from '../core/entities/student';
import type { Leader } from '../core/entities/leader';

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

export async function setup(opts: { moduleOn?: boolean; visibility?: 'admin' | 'all' } = {}) {
  const bus = new InMemoryBusRepository(); const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository(); const settings = new InMemorySettingsRepository();
  await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
  const cfg = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, {
    modules: { busMinistry: opts.moduleOn ?? true }, busMinistry: { visibility: opts.visibility ?? 'all' },
  });
  await settings.updateSettings({ ministryConfig: cfg });
  await students.save(student('s1', 'Jess', 'Tran', 9, 'female', '0412345678'));
  await students.save(student('s2', 'Sam', 'Ode', 8, 'male'));
  await students.save(student('s3', 'Riley', 'Kim', 10, 'male'));
  await leaders.save(leader('L1', 'Tom', 'male'));
  await leaders.save(leader('L2', 'Sarah', 'female'));
  const svc = makeBusService(bus, students, leaders, settings);
  const ctx = (role: string, asLeaderId: string | null = null, localNow = FRI_7PM): BusCtx => ({ actor: actor(role), asLeaderId, localNow });
  return { svc, bus, students, leaders, settings, ctx };
}

describe('gate', () => {
  it('module off → MODULE_DISABLED for everyone', async () => {
    const { svc, ctx } = await setup({ moduleOn: false });
    await expect(svc.getRun(ctx('admin'))).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
  it("visibility 'admin' hides it from non-admins only", async () => {
    const { svc, ctx } = await setup({ visibility: 'admin' });
    await expect(svc.getRun(ctx('director'))).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    await expect(svc.getRun(ctx('admin'))).resolves.toBeTruthy();
  });
});

describe('run lifecycle', () => {
  it('Saturday 00:40 still opens Friday', async () => {
    const { svc, ctx } = await setup();
    const v = await svc.getRun(ctx('admin', null, '2026-10-10T00:40'));
    expect(v.run.serviceDate).toBe('2026-10-09');
    expect(v.run.readOnly).toBe(false);
  });
  it('a new run copies last run vehicles (running + leaders), not tonight-only Ends at', async () => {
    const { svc, bus, ctx } = await setup();
    const now = '2026-10-01T00:00:00.000Z';
    await bus.saveVehicle({ id: 'v1', name: 'Big Bus', plate: null, seats: 12, prefGrades: [], endsAt: 'church', endsAddress: null, endsPlaceId: null, sort: 0, archived: false, createdAt: now, updatedAt: now });
    const first = await svc.getRun(ctx('admin', null, '2026-10-02T19:00'));
    const rv = first.vehicles[0]!;
    await bus.saveRunVehicle({ ...rv, leaderIds: ['L1'], endsAt: 'last_drop' });
    const next = await svc.getRun(ctx('admin', null, FRI_7PM));
    expect(next.vehicles[0]!.leaderIds).toEqual(['L1']);
    expect(next.vehicles[0]!.endsAt).toBe('church');
  });
});

describe('roster', () => {
  it('grade login can add; leader login cannot', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '24 Wynnum Rd, Carina QLD 4152, Australia' } });
    expect(r.name).toBe('Jess Tran');
    await expect(svc.addRider(ctx('leader'), { studentId: 's2', newAddress: { address: '1 A St, Bulimba' } })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('adding the same student twice updates instead of duplicating', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina' } });
    await svc.addRider(ctx('quad'), { studentId: 's1', newAddress: { label: "Dad's", address: '9 B St, Cannon Hill' } });
    const v = await svc.getRun(ctx('admin'));
    expect(v.riders).toHaveLength(1);
    expect(v.riders[0]!.address).toBe('9 B St, Cannon Hill');
  });
  it('search returns minimal fields and saved address labels, newest first', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina' } });
    const hits = await svc.search(ctx('grade'), 'tran');
    expect(hits[0]).toMatchObject({ kind: 'student', id: 's1', name: 'Jess Tran', grade: 9, gender: 'female' });
    expect(hits[0]!.addresses[0]!.label).toBe('Home');
    expect(Object.keys(hits[0]!)).not.toContain('mobile');
  });
  it('every write bumps the version and records who', async () => {
    const { svc, ctx } = await setup();
    const before = (await svc.getVersion(ctx('admin'))).version;
    await svc.addRider(ctx('grade', 'L2'), { studentId: 's2', newAddress: { address: '1 A St, Bulimba' } });
    const v = await svc.getRun(ctx('admin'));
    expect(v.run.version).toBe(before + 1);
    expect(v.run.lastChangeBy).toBe('Sarah');
  });
  it('riders from a finished night cannot be changed', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' } });
    await expect(svc.removeRider(ctx('grade', null, '2026-10-12T10:00'), r.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('walk-ins', () => {
  it('create guest → searchable → add as rider; purge after 28 days unused', async () => {
    const { svc, bus, ctx } = await setup();
    const g = await svc.createGuest(ctx('grade'), { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: '0400 111 222' });
    expect((await svc.search(ctx('grade'), 'harp'))[0]!.kind).toBe('guest');
    const stored = (await bus.getGuest(g.id))!;
    await bus.saveGuest({ ...stored, createdAt: '2026-08-01T00:00:00.000Z', lastRiddenAt: null });
    await svc.getRun(ctx('admin')); // triggers lazy purge
    expect(await bus.getGuest(g.id)).toBeNull();
  });
});
