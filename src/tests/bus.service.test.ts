import { describe, it, expect } from 'vitest';
import { makeBusService, type BusCtx } from '../services/bus.service';
import { InMemoryBusRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemorySettingsRepository, InMemoryConnectionRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { Student } from '../core/entities/student';
import type { Leader } from '../core/entities/leader';
import type { BusRunRider, BusConsent, BusGuest } from '../core/entities/bus';
import type { RoutingProvider } from '../services/routing/routing-provider';

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

export async function setup(opts: { moduleOn?: boolean; visibility?: 'admin' | 'all'; routing?: RoutingProvider } = {}) {
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
  const svc = makeBusService(bus, students, leaders, settings, opts.routing);
  const ctx = (role: string, asLeaderId: string | null = null, localNow = FRI_7PM): BusCtx => ({ actor: actor(role), asLeaderId, localNow });
  return { svc, bus, students, leaders, settings, ctx };
}

describe('gate', () => {
  it('module off → MODULE_DISABLED for everyone', async () => {
    const { svc, ctx } = await setup({ moduleOn: false });
    await expect(svc.getRun(ctx('admin'))).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
  it("a stored visibility 'admin' no longer hides it (setting removed 2026-10-09)", async () => {
    const { svc, ctx } = await setup({ visibility: 'admin' });
    await expect(svc.getRun(ctx('director'))).resolves.toBeTruthy();
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
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '24 Wynnum Rd, Carina QLD 4152, Australia' , placeId: 'fake:24-wynnum-rd-carina-qld-' } });
    expect(r.name).toBe('Jess Tran');
    await expect(svc.addRider(ctx('leader'), { studentId: 's2', newAddress: { address: '1 A St, Bulimba' , placeId: 'fake:1-a-st-bulimba' } })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('adding the same student twice updates instead of duplicating', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });
    await svc.addRider(ctx('quad'), { studentId: 's1', newAddress: { label: "Dad's", address: '9 B St, Cannon Hill' , placeId: 'fake:9-b-st-cannon-hill' } });
    const v = await svc.getRun(ctx('admin'));
    expect(v.riders).toHaveLength(1);
    expect(v.riders[0]!.address).toBe('9 B St, Cannon Hill');
  });
  it('search returns minimal fields and saved address labels, newest first', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });
    const hits = await svc.search(ctx('grade'), 'tran');
    expect(hits[0]).toMatchObject({ kind: 'student', id: 's1', name: 'Jess Tran', grade: 9, gender: 'female' });
    expect(hits[0]!.addresses[0]!.label).toBe('Home');
    expect(Object.keys(hits[0]!)).not.toContain('mobile');
  });
  it('every write bumps the version and records who', async () => {
    const { svc, ctx } = await setup();
    const before = (await svc.getVersion(ctx('admin'))).version;
    await svc.addRider(ctx('grade', 'L2'), { studentId: 's2', newAddress: { address: '1 A St, Bulimba' , placeId: 'fake:1-a-st-bulimba' } });
    const v = await svc.getRun(ctx('admin'));
    expect(v.run.version).toBe(before + 1);
    expect(v.run.lastChangeBy).toBe('Sarah');
  });
  it('riders from a finished night cannot be changed', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });
    await expect(svc.removeRider(ctx('grade', null, '2026-10-12T10:00'), r.id)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('two leaders adding the same student at once: the loser merges onto the winning row instead of a raw DB error', async () => {
    // Simulates the DB's unique (run_id, student_id)/(run_id, guest_id) index (migration 0011)
    // rejecting a NEW rider's insert with a Postgres unique-violation (code 23505) because
    // another request already inserted a row for the same student a moment earlier.
    class RacyBusRepository extends InMemoryBusRepository {
      private raced = false;
      override async saveRunRider(r: BusRunRider): Promise<BusRunRider> {
        if (!this.raced && r.studentId === 's1') {
          this.raced = true;
          // The "other leader"'s concurrent insert silently lands first.
          await super.saveRunRider({ ...r, id: 'r-other', snapAddress: 'First St, Carina' });
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        }
        return super.saveRunRider(r);
      }
    }
    const bus = new RacyBusRepository();
    const students = new InMemoryStudentRepository();
    const leaders = new InMemoryLeaderRepository();
    const settings = new InMemorySettingsRepository();
    await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
    await settings.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS,
      { modules: { busMinistry: true }, busMinistry: { visibility: 'all' } }) });
    await students.save(student('s1', 'Jess', 'Tran', 9, 'female'));
    const svc = makeBusService(bus, students, leaders, settings);
    const asGrade: BusCtx = { actor: actor('grade'), asLeaderId: null, localNow: FRI_7PM };
    const asAdmin: BusCtx = { actor: actor('admin'), asLeaderId: null, localNow: FRI_7PM };

    const r = await svc.addRider(asGrade, { studentId: 's1', newAddress: { address: 'Second St, Bulimba' , placeId: 'fake:second-st-bulimba' } });
    expect(r.address).toBe('Second St, Bulimba');

    const v = await svc.getRun(asAdmin);
    const mine = v.riders.filter((x) => x.studentId === 's1');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.address).toBe('Second St, Bulimba');
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

async function withFleet() {
  const t = await setup();
  const big = await t.svc.saveVehicle(t.ctx('admin'), { name: 'Big Bus', seats: 3, endsAt: 'church' });
  const v = await t.svc.getRun(t.ctx('admin'));
  const rvId = v.vehicles.find((x) => x.vehicleId === big.id)!.id;
  await t.svc.updateRunVehicle(t.ctx('admin'), rvId, { leaderIds: ['L1'] });
  const a = await t.svc.addRider(t.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });
  const b = await t.svc.addRider(t.ctx('grade'), { studentId: 's2', newAddress: { address: '2 B St, Bulimba' , placeId: 'fake:2-b-st-bulimba' } });
  const c = await t.svc.addRider(t.ctx('grade'), { studentId: 's3', newAddress: { address: '3 C St, Wynnum' , placeId: 'fake:3-c-st-wynnum' } });
  return { ...t, rvId, a, b, c };
}

describe('vehicles + move', () => {
  it('a vehicle created after tonight\'s run exists is added to tonight', async () => {
    const t = await withFleet();
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.vehicles[0]).toMatchObject({ name: 'Big Bus', capacity: 2, leaderNames: ['Tom'], eligibility: { male: true, female: false, unknown: false } });
  });
  it('move pins and appends; full car rejected with a readable message', async () => {
    const t = await withFleet();
    const m1 = await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    expect([m1.pinned, m1.stopOrder]).toEqual([true, 1]);
    const m2 = await t.svc.moveRider(t.ctx('quad'), t.b.id, { runVehicleId: t.rvId });
    expect(m2.stopOrder).toBe(2);
    await expect(t.svc.moveRider(t.ctx('quad'), t.c.id, { runVehicleId: t.rvId })).rejects.toThrow('Big Bus is full');
  });
  it('grade login cannot move; a self-identified coordinator can', async () => {
    const t = await withFleet();
    await expect(t.svc.moveRider(t.ctx('grade'), t.a.id, { runVehicleId: t.rvId })).rejects.toMatchObject({ statusCode: 403 });
    const s = await t.settings.getSettings();
    await t.settings.updateSettings({ ministryConfig: { ...s.ministryConfig, busMinistry: { ...s.ministryConfig.busMinistry, coordinatorLeaderIds: ['L2'] } } });
    await expect(t.svc.moveRider(t.ctx('grade', 'L2'), t.a.id, { runVehicleId: t.rvId })).resolves.toBeTruthy();
  });
});

describe('my car', () => {
  it('shows only my car with student mobiles; a vanished student shows no phone', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('admin'), t.a.id, { runVehicleId: t.rvId });
    await t.svc.moveRider(t.ctx('admin'), t.b.id, { runVehicleId: t.rvId });
    await t.students.delete('s2');
    const mine = await t.svc.myCar(t.ctx('grade', 'L1'));
    expect(mine.stops.map((s) => [s.name, s.mobile])).toEqual([['Jess Tran', '0412345678'], ['Sam Ode', null]]);
    const notMine = await t.svc.myCar(t.ctx('grade', 'L2'));
    expect(notMine.vehicle).toBeNull();
  });
  it('own car takes riders off the bus and pre-fills next week', async () => {
    const t = await withFleet();
    const own = await t.svc.saveOwnCar(t.ctx('grade', 'L2'), { car: { name: "Sarah's car", seats: 5, endsAt: 'address', endsAddress: '5 Home St, Manly', endsPlaceId: 'fake:5-home-st' }, riderIds: [t.c.id] });
    expect(own.ownerLeaderId).toBe('L2');
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.riders.find((r) => r.id === t.c.id)!.runVehicleId).toBe(own.id);
    const nextWeek = await t.svc.myCar(t.ctx('grade', 'L2', '2026-10-16T18:00'));
    expect(nextWeek.ownCarDraft!.car!.name).toBe("Sarah's car");
  });
  // Task 6: confirmed this already works — self-identification via `as=` is spoofable by
  // design (spec §4), and a bus:coordinate login (quad/director/admin) already has `bus:use`
  // outright via ROLE_PERMISSIONS, so `removeOwnCar` resolves `me` to whatever `as=` names and
  // finds/deletes THAT leader's own car. The SPA call is simply
  // `DELETE /bus/run/own-car?now=<local>&as=<ownerLeaderId>` from the coordinator's own session
  // (no leader login/record needed) — no new route was added.
  it('Task 6: a quad coordinator can remove another leader\'s own car via as=', async () => {
    const t = await withFleet();
    await t.svc.saveOwnCar(t.ctx('grade', 'L2'), { car: { name: "Sarah's car", seats: 5, endsAt: 'church' }, riderIds: [t.c.id] });
    expect((await t.svc.getRun(t.ctx('admin'))).vehicles.find((v) => v.ownerLeaderId === 'L2')).toBeTruthy();
    await t.svc.removeOwnCar(t.ctx('quad', 'L2')); // a different account, self-identifying AS Sarah
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.vehicles.find((x) => x.ownerLeaderId === 'L2')).toBeUndefined();
    expect(v.riders.find((r) => r.id === t.c.id)!.runVehicleId).toBeNull(); // rider freed, not orphaned
  });
});

// Owner (2026-10-07): a junior `leader` login has bus:use but not bus:roster — the Students tab
// is hidden from them in the SPA, but "Your car" now lets them search and add someone new
// straight into their OWN car via the same bus:use-gated saveOwnCar call (newRiders).
describe('own-car newRiders (junior leader, bus:use only, 2026-10-07)', () => {
  const juniorLeaderCtx = (): BusCtx => ({ actor: actor('leader', { leaderId: 'L1' }), asLeaderId: null, localNow: FRI_7PM });
  it('search by a junior leader: only their connected students, no addresses; roster actors unchanged', async () => {
    const { bus, students, leaders, settings, ctx, svc: admin } = await setup();
    await admin.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } });
    const conns = new InMemoryConnectionRepository(); await conns.init();
    const svc = makeBusService(bus, students, leaders, settings, undefined, conns);
    expect(await svc.search(juniorLeaderCtx(), 'tran')).toEqual([]); // not connected -> hidden
    await conns.save({ id: 'c1', studentId: 's1', leaderId: 'L1', assignedByRole: 'admin', createdAt: '2026-01-01T00:00:00.000Z' });
    const hits = await svc.search(juniorLeaderCtx(), 'tran');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.addresses).toEqual([]);
    expect((await svc.search(ctx('grade'), 'tran'))[0]!.addresses.length).toBe(1);
  });
  it('saveOwnCar rejects an unknown leader id', async () => {
    const { svc, ctx } = await setup();
    await expect(svc.saveOwnCar(ctx('grade', 'nope'), { car: { name: 'X', seats: 4, endsAt: 'church' }, riderIds: [] }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
  it('getRun still loads when guest cleanup throws', async () => {
    const { svc, bus, ctx } = await setup();
    await bus.saveGuest({ id: 'g-old', firstName: 'Old', lastName: 'Guest', grade: 8, gender: 'male', phone: null, linkedStudentId: null, dismissed: false, createdAt: '2020-01-01T00:00:00.000Z', lastRiddenAt: null });
    bus.deleteGuest = async () => { throw new Error('boom'); };
    await expect(svc.getRun(ctx('admin'))).resolves.toBeTruthy();
  });
  it('a student + new address adds the rider to tonight and places them in the leader\'s own car', async () => {
    const { svc, ctx } = await setup();
    const own = await svc.saveOwnCar(juniorLeaderCtx(), { car: { name: "Tom's car", seats: 4, endsAt: 'church' }, riderIds: [],
      newRiders: [{ studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } }] });
    const v = await svc.getRun(ctx('admin'));
    const r = v.riders.find((x) => x.studentId === 's1');
    expect(r).toBeTruthy();
    expect(r!.runVehicleId).toBe(own.id);
  });
  it('a newPerson entry creates a guest and places them in the car', async () => {
    const { svc, bus, ctx } = await setup();
    const own = await svc.saveOwnCar(juniorLeaderCtx(), { car: { name: "Tom's car", seats: 4, endsAt: 'church' }, riderIds: [],
      newRiders: [{ newPerson: { firstName: 'Casey', lastName: 'Walker', grade: 8, gender: 'male', phone: null },
        newAddress: { label: 'Home', address: '7 New St, Bulimba', placeId: 'fake:7-new-st-bulimba' } }] });
    const guests = await bus.listGuests();
    expect(guests.some((g) => g.firstName === 'Casey' && g.lastName === 'Walker')).toBe(true);
    const v = await svc.getRun(ctx('admin'));
    const r = v.riders.find((x) => x.name === 'Casey Walker');
    expect(r?.runVehicleId).toBe(own.id);
  });
  it('someone already on tonight is not duplicated, just placed in the car', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } });
    const before = await svc.getRun(ctx('admin'));
    expect(before.riders).toHaveLength(1);
    const originalAddress = before.riders[0]!.address;
    const own = await svc.saveOwnCar(juniorLeaderCtx(), { car: { name: "Tom's car", seats: 4, endsAt: 'church' }, riderIds: [],
      // a bogus address — proves the already-on-tonight path never touches placeRider/resolveAddress
      newRiders: [{ studentId: 's1', newAddress: { label: 'Wrong', address: '99 Wrong St, Nowhere', placeId: 'fake:99-wrong-st' } }] });
    const after = await svc.getRun(ctx('admin'));
    expect(after.riders).toHaveLength(1); // not duplicated
    expect(after.riders[0]!.runVehicleId).toBe(own.id);
    expect(after.riders[0]!.address).toBe(originalAddress); // untouched by the skipped add
  });
});

describe('guest linking', () => {
  it('exactly one name match links and moves addresses; ambiguous ones become suggestions', async () => {
    const t = await setup();
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: '0400000000' });
    await t.svc.addRider(t.ctx('grade'), { guestId: g.id, newAddress: { label: 'Home', address: '3 C St, Wynnum' , placeId: 'fake:3-c-st-wynnum' } });
    const g2 = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Jessi', lastName: 'Tran', grade: 9, gender: 'female', phone: '0400000001' });
    await t.students.save(student('s4', 'Jessica', 'Tran', 9, 'female'));
    expect((await t.svc.linkGuestsAfterImport()).linked).toBe(1);   // Riley Kim ↔ s3
    expect((await t.bus.listAddresses({ studentId: 's3' }))[0]!.label).toBe('Home');
    const pending = await t.svc.pendingGuests(t.ctx('director'));
    expect(pending.map((p) => p.id)).toEqual([g2.id]);
    expect(pending[0]!.suggestions.map((s) => s.studentId).sort()).toEqual(['s1', 's4']);
  });

  // Task 2 (owner): "New people from Bus Ministry" must also suggest a student whose OWN mobile
  // or parent phone matches the guest's phone — not just a last-name/first-name-prefix match.
  it('Task 2: matches by phone (mobile), even with no name overlap at all', async () => {
    const t = await setup(); // s1 'Jess Tran' seeded with mobile '0412345678'
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Random', lastName: 'Walker', grade: 9, gender: 'female', phone: '+61 412 345 678' });
    const pending = await t.svc.pendingGuests(t.ctx('director'));
    expect(pending.find((p) => p.id === g.id)!.suggestions).toEqual([{ studentId: 's1', name: 'Jess Tran', grade: 9, byPhone: true }]);
  });
  it('Task 2: matches by parent phone too, leading 0/61 normalised the same way', async () => {
    const t = await setup();
    await t.students.save({ ...(await t.students.findById('s2'))!, parentPhone: '0433222111' });
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Random', lastName: 'Other', grade: 8, gender: 'male', phone: '61433222111' });
    const pending = await t.svc.pendingGuests(t.ctx('director'));
    expect(pending.find((p) => p.id === g.id)!.suggestions).toEqual([{ studentId: 's2', name: 'Sam Ode', grade: 8, byPhone: true }]);
  });
  it('Task 2: a student matching both by phone and by name is listed once, flagged byPhone', async () => {
    const t = await setup();
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Jess', lastName: 'Tran', grade: 9, gender: 'female', phone: '0412345678' });
    const pending = await t.svc.pendingGuests(t.ctx('director'));
    expect(pending.find((p) => p.id === g.id)!.suggestions).toEqual([{ studentId: 's1', name: 'Jess Tran', grade: 9, byPhone: true }]);
  });
});

describe('parent consent', () => {
  // Task 3 (bug): setConsent didn't check the Generate lock, unlike every other rider write
  // (addRider/updateRider/removeRider/moveRider) — a consent tick mid-solve could race Generate's
  // own writes to the same rider row.
  it('Task 3: setConsent is blocked while the Generate lock is active, like other rider writes', async () => {
    const t = await setup();
    const r = await t.svc.addRider(t.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } });
    const runId = (await t.svc.getRun(t.ctx('admin'))).run.id;
    await t.bus.tryLock(runId, 'someone#tok', new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
    await expect(t.svc.setConsent(t.ctx('grade'), r.id, { given: true, note: 'x' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('starts as not yet, persists to next week, and follows a linked walk-in', async () => {
    const t = await setup();
    const r = await t.svc.addRider(t.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });
    expect((await t.svc.getRun(t.ctx('admin'))).riders[0]!.consent).toBeNull();
    await expect(t.svc.setConsent(t.ctx('grade'), r.id, { given: true, note: '' })).rejects.toThrow();
    const v = await t.svc.setConsent(t.ctx('grade', 'L2'), r.id, { given: true, note: 'Mum (Lisa) 7:10pm by text' });
    expect(v.consent).toMatchObject({ given: true, note: 'Mum (Lisa) 7:10pm by text', recordedBy: 'Sarah' });
    await t.svc.addRider(t.ctx('grade', null, '2026-10-16T19:00'), { studentId: 's1', newAddress: { address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });
    const next = await t.svc.getRun(t.ctx('admin', null, '2026-10-16T19:00'));
    expect(next.riders[0]!.consent!.given).toBe(true);
    await expect(t.svc.setConsent(t.ctx('leader'), r.id, { given: false, note: '' })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("a walk-in's consent moves to the student on link", async () => {
    const t = await setup();
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: '0400000000' });
    const r = await t.svc.addRider(t.ctx('grade'), { guestId: g.id, newAddress: { address: '3 C St, Wynnum' , placeId: 'fake:3-c-st-wynnum' } });
    await t.svc.setConsent(t.ctx('grade'), r.id, { given: true, note: 'Dad, call 7pm' });
    await t.svc.linkGuestsAfterImport();
    expect((await t.bus.getConsent({ studentId: 's3' }))!.note).toBe('Dad, call 7pm');
  });
  it('first-time consent race: two leaders ticking at once merges onto one row, not a raw 500', async () => {
    // Simulates the DB's unique student_id/guest_id index on bus_consents (migration 0012)
    // rejecting a NEW consent's insert with a Postgres unique-violation (code 23505) because
    // another request already inserted the first consent row for the same person a moment
    // earlier — the same race addRider already defends against for bus_run_riders.
    class RacyConsentBusRepository extends InMemoryBusRepository {
      private raced = false;
      override async saveConsent(c: BusConsent): Promise<BusConsent> {
        if (!this.raced && c.studentId === 's1') {
          this.raced = true;
          // The "other leader"'s concurrent first-time consent silently lands first.
          await super.saveConsent({ ...c, id: 'c-other', note: 'First leader, 7:05pm' });
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        }
        return super.saveConsent(c);
      }
    }
    const bus = new RacyConsentBusRepository();
    const students = new InMemoryStudentRepository();
    const leaders = new InMemoryLeaderRepository();
    const settings = new InMemorySettingsRepository();
    await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
    await settings.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS,
      { modules: { busMinistry: true }, busMinistry: { visibility: 'all' } }) });
    await students.save(student('s1', 'Jess', 'Tran', 9, 'female'));
    const svc = makeBusService(bus, students, leaders, settings);
    const asGrade: BusCtx = { actor: actor('grade'), asLeaderId: null, localNow: FRI_7PM };
    const r = await svc.addRider(asGrade, { studentId: 's1', newAddress: { address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });

    const v = await svc.setConsent(asGrade, r.id, { given: true, note: 'Second leader, 7:06pm' });
    expect(v.consent).toMatchObject({ given: true, note: 'Second leader, 7:06pm' });
    const rows = await bus.listConsents();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe('Second leader, 7:06pm');
  });
});

describe('drop-off record', () => {
  it('car leaders tick with a time, can edit and clear it; others cannot', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('admin'), t.a.id, { runVehicleId: t.rvId });
    const d = await t.svc.setDropped(t.ctx('grade', 'L1'), t.a.id, { dropped: true });
    expect(d.droppedAt).not.toBeNull();
    expect(d.droppedBy).toBe('Tom');
    const e = await t.svc.setDropped(t.ctx('grade', 'L1'), t.a.id, { dropped: true, at: '2026-10-09T11:42:00.000Z' });
    expect(e.droppedAt).toBe('2026-10-09T11:42:00.000Z');
    await expect(t.svc.setDropped(t.ctx('grade', 'L2'), t.a.id, { dropped: true })).rejects.toMatchObject({ statusCode: 403 });
    expect((await t.svc.setDropped(t.ctx('quad'), t.a.id, { dropped: false })).droppedAt).toBeNull();
  });
});

describe('history', () => {
  it('lists past runs for director only and keeps snapshots', async () => {
    const t = await withFleet();
    expect(await t.svc.listRuns(t.ctx('director', null, '2026-10-12T10:00'))).toHaveLength(1);
    await expect(t.svc.listRuns(t.ctx('quad'))).rejects.toMatchObject({ statusCode: 403 });
    const past = await t.svc.getPastRun(t.ctx('admin', null, '2026-10-12T10:00'), (await t.svc.getVersion(t.ctx('admin'))).runId);
    expect(past.run.readOnly).toBe(true);
    expect(past.riders).toHaveLength(3);
  });
});

describe('Zod refine messages reach the user (M1)', () => {
  it('addRider surfaces the refine message, not generic "Validation failed"', async () => {
    const { svc, ctx } = await setup();
    await expect(svc.addRider(ctx('grade'), {})).rejects.toMatchObject({ message: 'Choose a student or a new person' });
  });
});

describe('createGuest input validation (C2)', () => {
  it('rejects a name containing a quote/angle-bracket and a malformed phone', async () => {
    const { svc, ctx } = await setup();
    await expect(svc.createGuest(ctx('grade'), { firstName: 'a"onmouseover="x', lastName: 'Ng', grade: 8, gender: 'female', phone: '0400 111 222' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.createGuest(ctx('grade'), { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: 'call-me!' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
  // Task 5 (owner): phone is now optional — blank/omitted stores as null; a given value still
  // needs >=8 digits once separators are stripped, or it's rejected.
  it('Task 5: blank or omitted phone stores as null; a too-short phone is rejected; a valid one is kept', async () => {
    const { svc, bus, ctx } = await setup();
    const g1 = await svc.createGuest(ctx('grade'), { firstName: 'Noor', lastName: 'Ali', grade: 8, gender: 'female', phone: '' });
    expect((await bus.getGuest(g1.id))!.phone).toBeNull();
    const g2 = await svc.createGuest(ctx('grade'), { firstName: 'Sam', lastName: 'Lee', grade: 8, gender: 'male' });
    expect((await bus.getGuest(g2.id))!.phone).toBeNull();
    await expect(svc.createGuest(ctx('grade'), { firstName: 'Joy', lastName: 'Park', grade: 8, gender: 'female', phone: '12345' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Check the phone number' });
    const g3 = await svc.createGuest(ctx('grade'), { firstName: 'Lee', lastName: 'Park', grade: 8, gender: 'male', phone: '+61 412 345 678' });
    expect((await bus.getGuest(g3.id))!.phone).toBe('+61 412 345 678');
  });
});

describe('leader role sees "My car only" on the shared run view (I1)', () => {
  it('a non-coordinating leader gets suburb-only addresses, a bare consent flag, and no leaders/fleet', async () => {
    const t = await withFleet();
    await t.svc.setConsent(t.ctx('grade', 'L2'), t.a.id, { given: true, note: 'Mum (Lisa) 7:10pm by text' });
    const leaderCtx: BusCtx = { actor: actor('leader', { leaderId: 'L1' }), asLeaderId: null, localNow: FRI_7PM };
    const v = await t.svc.getRun(leaderCtx);
    // every rider is address-redacted
    for (const r of v.riders) {
      expect(r.studentId).toBeNull();
      expect(r.address).not.toContain('St');
    }
    const ridden = v.riders.find((r) => r.id === t.a.id)!;
    expect(ridden.consent).toEqual({ given: true });
    expect(v.leaders).toEqual([]);
    expect(v.fleet).toEqual([]);
  });
});

describe('/bus/search returns labels + suburb only, never the full street address (I2)', () => {
  it('search hits never carry the saved street address', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '24 Wynnum Rd, Carina QLD 4152, Australia' , placeId: 'fake:24-wynnum-rd-carina-qld-' } });
    const hits = await svc.search(ctx('grade'), 'tran');
    // Task 3 (owner): `street` is a new, deliberate fallback field (the decrypted address's
    // street part) — the raw, full stored `address` (incl. suburb/postcode) is still never sent.
    expect(hits[0]!.addresses[0]).toEqual({ id: hits[0]!.addresses[0]!.id, label: 'Home', suburb: 'Carina', street: '24 Wynnum Rd' });
    expect(Object.keys(hits[0]!.addresses[0]!)).not.toContain('address');
  });
});

describe('own car write-ordering (I6)', () => {
  it('rejects unknown riders / over-capacity before writing the car, leaving no orphaned vehicle', async () => {
    const t = await setup();
    await expect(t.svc.saveOwnCar(t.ctx('grade', 'L1'), { car: { name: "Tom's car", seats: 2, endsAt: 'church' }, riderIds: ['missing-id'] }))
      .rejects.toMatchObject({ statusCode: 404 });
    let v = await t.svc.getRun(t.ctx('admin'));
    expect(v.vehicles.find((x) => x.ownerLeaderId === 'L1')).toBeUndefined();

    const a = await t.svc.addRider(t.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' , placeId: 'fake:1-a-st-carina' } });
    const b = await t.svc.addRider(t.ctx('grade'), { studentId: 's2', newAddress: { address: '2 B St, Bulimba' , placeId: 'fake:2-b-st-bulimba' } });
    await expect(t.svc.saveOwnCar(t.ctx('grade', 'L1'), { car: { name: "Tom's car", seats: 2, endsAt: 'church' }, riderIds: [a.id, b.id] }))
      .rejects.toThrow('only has 1 seats');
    v = await t.svc.getRun(t.ctx('admin'));
    expect(v.vehicles.find((x) => x.ownerLeaderId === 'L1')).toBeUndefined();
  });
});

// M5: listRuns ("Past nights") must only ever return nights strictly before tonight's run.
describe('listRuns excludes tonight and any future run (M5)', () => {
  it("excludes tonight's own run, not just a future one", async () => {
    const t = await withFleet(); // creates the run for FRI_7PM (2026-10-09)
    const tonight = await t.svc.listRuns(t.ctx('director'));
    expect(tonight).toHaveLength(0);
    const nextWeek = await t.svc.listRuns(t.ctx('director', null, '2026-10-16T19:00'));
    expect(nextWeek).toHaveLength(1); // last Friday's run is now in the past
  });
});

describe('linking a walk-in deletes the guest row (I3)', () => {
  it('linkGuestsAfterImport removes the linked guest so its phone number does not linger', async () => {
    const t = await setup();
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: '0400000000' });
    await t.svc.addRider(t.ctx('grade'), { guestId: g.id, newAddress: { address: '3 C St, Wynnum' , placeId: 'fake:3-c-st-wynnum' } });
    expect((await t.svc.linkGuestsAfterImport()).linked).toBe(1); // Riley Kim <-> s3
    expect(await t.bus.getGuest(g.id)).toBeNull();
  });
});

describe('linking into a run where the student already has a rider (I4)', () => {
  it('drops the duplicate walk-in row instead of a raw unique-constraint error', async () => {
    const t = await setup();
    const real = await t.svc.addRider(t.ctx('grade'), { studentId: 's3', newAddress: { address: '3 C St, Wynnum' , placeId: 'fake:3-c-st-wynnum' } });
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: '0400000000' });
    await t.svc.addRider(t.ctx('grade'), { guestId: g.id, newAddress: { label: 'Home', address: '9 D St, Wynnum' , placeId: 'fake:9-d-st-wynnum' } });
    expect((await t.svc.getRun(t.ctx('admin'))).riders).toHaveLength(2);
    expect((await t.svc.linkGuestsAfterImport()).linked).toBe(1);
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.riders).toHaveLength(1);
    expect(v.riders[0]!.id).toBe(real.id);
    expect(await t.bus.getGuest(g.id)).toBeNull();
  });

  it('linkGuestsAfterImport continues past a guest whose link fails', async () => {
    class FlakyBusRepository extends InMemoryBusRepository {
      override async reassignGuestConsent(guestId: string, studentId: string): Promise<void> {
        if (guestId === 'bad') throw new Error('boom');
        return super.reassignGuestConsent(guestId, studentId);
      }
    }
    const bus = new FlakyBusRepository();
    const students = new InMemoryStudentRepository();
    const leaders = new InMemoryLeaderRepository();
    const settings = new InMemorySettingsRepository();
    await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
    await settings.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS,
      { modules: { busMinistry: true }, busMinistry: { visibility: 'all' } }) });
    await students.save(student('s1', 'Jess', 'Tran', 9, 'female'));
    await students.save(student('s2', 'Sam', 'Ode', 8, 'male'));
    const svc = makeBusService(bus, students, leaders, settings);
    const now = '2026-01-01T00:00:00.000Z';
    const mkGuest = (id: string, first: string, last: string, grade: number, gender: 'male' | 'female', phone: string): BusGuest =>
      ({ id, firstName: first, lastName: last, grade, gender, phone, linkedStudentId: null, dismissed: false, createdAt: now, lastRiddenAt: null });
    await bus.saveGuest(mkGuest('bad', 'Jess', 'Tran', 9, 'female', '0400000000'));
    await bus.saveGuest(mkGuest('good', 'Sam', 'Ode', 8, 'male', '0400000001'));
    const result = await svc.linkGuestsAfterImport();
    expect(result.linked).toBe(1); // 'good' linked despite 'bad' failing
    expect(await bus.getGuest('good')).toBeNull();
    expect(await bus.getGuest('bad')).not.toBeNull();
  });
});

describe('ensureRun drops inactive/deleted leaders when copying forward (I7)', () => {
  it('a leader deactivated before next run is dropped from the carry-over; a leader deleted mid-run is dropped from the view', async () => {
    const t = await setup();
    const big = await t.svc.saveVehicle(t.ctx('admin'), { name: 'Big Bus', seats: 5, endsAt: 'church' });
    const v = await t.svc.getRun(t.ctx('admin'));
    const rvId = v.vehicles.find((x) => x.vehicleId === big.id)!.id;
    await t.svc.updateRunVehicle(t.ctx('admin'), rvId, { leaderIds: ['L1', 'L2'] });

    const l1 = (await t.leaders.findById('L1'))!;
    await t.leaders.save({ ...l1, active: false });

    const next = await t.svc.getRun(t.ctx('admin', null, '2026-10-16T19:00'));
    const rv = next.vehicles.find((x) => x.vehicleId === big.id)!;
    expect(rv.leaderIds).toEqual(['L2']);
    expect(rv.capacity).toBe(4);
    expect(rv.leaderNames).toEqual(['Sarah']);

    await t.leaders.delete('L2');
    const after = await t.svc.getRun(t.ctx('admin', null, '2026-10-16T19:00'));
    const rv2 = after.vehicles.find((x) => x.vehicleId === big.id)!;
    expect(rv2.leaderIds).toEqual([]);
    expect(rv2.capacity).toBe(5);
    expect(rv2.eligibility).toEqual({ female: false, male: false, unknown: true });
  });
});

describe('archiving a vehicle unassigns its riders (M2)', () => {
  it('clears runVehicleId/stopOrder/pinned instead of relying on a DB cascade', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('admin'), t.a.id, { runVehicleId: t.rvId });
    const fleetId = (await t.svc.getRun(t.ctx('admin'))).fleet[0]!.id;
    await t.svc.saveVehicle(t.ctx('admin'), { id: fleetId, name: 'Big Bus', seats: 3, endsAt: 'church', archived: true });
    const v = await t.svc.getRun(t.ctx('admin'));
    const rider = v.riders.find((r) => r.id === t.a.id)!;
    expect(rider.runVehicleId).toBeNull();
    expect(rider.stopOrder).toBeNull();
    expect(rider.pinned).toBe(false);
  });
});

// I4 (controller ruling): once the real Google provider is live, a "fake:" place ID — only
// ever produced by the dev/test fallback provider — must be rejected wherever it's saved, or
// every future Generate 400s against Google with no clue why.
describe('I4: a "fake:" place ID is rejected once the Google provider is live', () => {
  const googleStub: RoutingProvider = {
    name: 'google',
    solve: async () => ({ routes: [], skipped: [] }),
    autocomplete: async () => [],
    matrix: async () => [],
    staticMap: async () => ({ contentType: 'image/png', bytes: new Uint8Array() }),
    route: async () => ({ polyline: '', stops: [] }),
  };
  it('rejects a new rider address with a fake: place ID — but the same input is fine against the dev/test fake provider', async () => {
    const live = await setup({ routing: googleStub });
    await expect(live.svc.addRider(live.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st:1' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    const dev = await setup();
    await expect(dev.svc.addRider(dev.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st:1' } }))
      .resolves.toBeTruthy();
  });
  it('rejects a fleet vehicle end-address with a fake: place ID', async () => {
    const t = await setup({ routing: googleStub });
    await expect(t.svc.saveVehicle(t.ctx('admin'), { name: 'Van', seats: 8, endsAt: 'address', endsAddress: 'X', endsPlaceId: 'fake:x' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
  it('rejects an own car end-address with a fake: place ID', async () => {
    const t = await setup({ routing: googleStub });
    await expect(t.svc.saveOwnCar(t.ctx('grade', 'L1'),
      { car: { name: 'My car', seats: 4, plate: null, endsAt: 'address', endsAddress: 'X', endsPlaceId: 'fake:x' }, riderIds: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

// Task 2 (owner): a brand-new address must come from a real suggestion — a null/missing placeId
// is rejected with a clear message, for every "new address" path. An existing saved address
// (by addressId) is untouched by this check.
describe('Task 2: new-address paths reject a missing placeId', () => {
  it('a new rider address with no placeId is rejected; the same address with a placeId works', async () => {
    const { svc, ctx } = await setup();
    await expect(svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: null } }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Pick the address from the suggestions list' });
    await expect(svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st' } }))
      .resolves.toBeTruthy();
  });
  it('an existing saved address (by addressId) still works with no re-pick required', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st' } });
    await expect(svc.updateRider(ctx('grade'), r.id, { addressId: r.addressId! })).resolves.toBeTruthy();
  });
  it('a fleet vehicle set to end at an address with no placeId is rejected; other end modes need none', async () => {
    const { svc, ctx } = await setup();
    await expect(svc.saveVehicle(ctx('admin'), { name: 'Van', seats: 8, endsAt: 'address', endsAddress: 'X', endsPlaceId: null }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Pick the address from the suggestions list' });
    await expect(svc.saveVehicle(ctx('admin'), { name: 'Van', seats: 8, endsAt: 'church' })).resolves.toBeTruthy();
  });
  it('an own car set to end at an address with no placeId is rejected', async () => {
    const { svc, ctx } = await setup();
    await expect(svc.saveOwnCar(ctx('grade', 'L1'),
      { car: { name: 'My car', seats: 4, plate: null, endsAt: 'address', endsAddress: 'X', endsPlaceId: null }, riderIds: [] }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Pick the address from the suggestions list' });
  });
  it('PERSISTENCE=memory / fake-provider suggestions still carry a real placeId, so a normal add keeps working', async () => {
    const { svc, ctx } = await setup();
    const suggestions = await svc.autocomplete(ctx('admin'), '24 Wynnum Rd', 'sess-12345678');
    expect(suggestions[0]!.placeId).toBeTruthy();
    await expect(svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: suggestions[0]!.text, placeId: suggestions[0]!.placeId } }))
      .resolves.toBeTruthy();
  });
});

// Task 3 (owner): a blank label defaults to the street part (not the suburb) of the address, so
// it's useful when the address is later offered back for selection.
describe('Task 3: default label is the street part', () => {
  it('a new address saved with a blank label gets the street part as its label', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '24 Wynnum Rd, Carina QLD 4152, Australia', placeId: 'fake:1' } });
    const hits = await svc.search(ctx('grade'), 'tran');
    expect(hits[0]!.addresses.find((a) => a.id === r.addressId)!.label).toBe('24 Wynnum Rd');
  });
  it('an explicit label is kept as-is, not overridden by the street default', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Mum\'s place', address: '24 Wynnum Rd, Carina QLD 4152, Australia', placeId: 'fake:1' } });
    const hits = await svc.search(ctx('grade'), 'tran');
    expect(hits[0]!.addresses.find((a) => a.id === r.addressId)!.label).toBe("Mum's place");
  });
});

// Task 5 (owner): deleting a "New Person" (a guest) from tonight fully removes them — including
// their saved addresses — once they have no bus_run_riders row left in any run and were never
// linked to a real student. Students are never deleted by this path.
describe('Task 5: removing a rider fully deletes an orphaned guest', () => {
  it('a guest with no other run rows is deleted entirely, including their saved address', async () => {
    const { svc, bus, ctx } = await setup();
    const g = await svc.createGuest(ctx('grade'), { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: '0400 111 222' });
    const r = await svc.addRider(ctx('grade'), { guestId: g.id, newAddress: { address: '3 C St, Wynnum', placeId: 'fake:3-c-st' } });
    expect(await bus.listAddresses({ guestId: g.id })).toHaveLength(1);
    await svc.removeRider(ctx('grade'), r.id);
    expect(await bus.getGuest(g.id)).toBeNull();
    expect(await bus.listAddresses({ guestId: g.id })).toHaveLength(0);
    const pending = await svc.pendingGuests(ctx('director'));
    expect(pending.map((p) => p.id)).not.toContain(g.id); // pending-new-people count drops too
  });
  it('a guest still riding on a past run is NOT deleted when removed from tonight', async () => {
    const { svc, bus, ctx } = await setup();
    const g = await svc.createGuest(ctx('grade'), { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: '0400 111 222' });
    await svc.addRider(ctx('grade', null, '2026-10-09T19:00'), { guestId: g.id, newAddress: { address: '3 C St, Wynnum', placeId: 'fake:3-c-st' } });
    const r2 = await svc.addRider(ctx('grade', null, '2026-10-16T19:00'), { guestId: g.id, addressId: (await bus.listAddresses({ guestId: g.id }))[0]!.id });
    await svc.removeRider(ctx('grade', null, '2026-10-16T19:00'), r2.id); // only removes this week's row
    expect(await bus.getGuest(g.id)).not.toBeNull(); // last week's row still references them
  });
  it('a linked guest (now a real student rider) is never deleted by removeRider', async () => {
    const { svc, bus, ctx } = await setup();
    const g = await svc.createGuest(ctx('grade'), { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: '0400000000' });
    const r = await svc.addRider(ctx('grade'), { guestId: g.id, newAddress: { address: '3 C St, Wynnum', placeId: 'fake:3-c-st' } });
    await svc.linkGuestsAfterImport(); // links g -> s3, deletes the guest row via the existing linking path (I3)
    expect(await bus.getGuest(g.id)).toBeNull(); // already gone from linking, not from removeRider
    const linkedRider = (await svc.getRun(ctx('admin'))).riders.find((x) => x.studentId === 's3')!;
    await svc.removeRider(ctx('grade'), linkedRider.id); // removing the now-student rider must not throw on a missing guest
    expect((await svc.getRun(ctx('admin'))).riders.find((x) => x.studentId === 's3')).toBeUndefined();
    void r;
  });
});

// Task 10 (owner): the "who are you" self-identifier must offer every leader on a car THIS
// week — any running run-vehicle's leaderIds plus an own-car's ownerLeaderId — even one outside
// the login's own grade/quad scope. Names + ids only.
describe('Task 10: onCarLeaders', () => {
  it('lists leaders on a running car (fleet + own car), sorted by name, excluding leaders not on a car', async () => {
    const t = await withFleet(); // Big Bus, leaders: ['L1'] (Tom)
    await t.svc.saveOwnCar(t.ctx('grade', 'L2'), { car: { name: "Sarah's car", seats: 5, endsAt: 'last_drop' }, riderIds: [] });
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.onCarLeaders).toEqual([{ id: 'L2', name: 'Sarah' }, { id: 'L1', name: 'Tom' }]); // sorted by name
  });
  it('myCar() exposes the same onCarLeaders list', async () => {
    const t = await withFleet();
    const mine = await t.svc.myCar(t.ctx('admin'));
    expect(mine.onCarLeaders).toEqual([{ id: 'L1', name: 'Tom' }]);
  });
});

describe('riderAddresses — the edit sheet loads by rider, not by name search', () => {
  it('returns the rider\'s saved addresses with the current one first', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Mum', address: '24 Wynnum Rd, Carina QLD 4152, Australia', placeId: 'fake:24-wynnum-rd-carina-qld-' } });
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: '', address: '3 Lindsay Ct, Cornubia QLD 4130, Australia', placeId: 'fake:3-lindsay-ct-cornubia-qld-' } });
    const addrs = await svc.riderAddresses(ctx('grade'), r.id);
    expect(addrs.map((a) => a.street)).toEqual(['3 Lindsay Ct', '24 Wynnum Rd']);
    expect(addrs[0]!.label).toBe('3 Lindsay Ct');
  });
});

describe('deleteRiderAddress — edit sheet forgets a saved address', () => {
  it('deletes a non-current address; an unknown one 404s', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Mum', address: '24 Wynnum Rd, Carina QLD 4152, Australia', placeId: 'fake:24-wynnum-rd-carina-qld-' } });
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: '', address: '3 Lindsay Ct, Cornubia QLD 4130, Australia', placeId: 'fake:3-lindsay-ct-cornubia-qld-' } });
    const [current, old] = await svc.riderAddresses(ctx('grade'), r.id);
    await expect(svc.deleteRiderAddress(ctx('grade'), r.id, 'nope')).rejects.toMatchObject({ statusCode: 404 });
    await svc.deleteRiderAddress(ctx('grade'), r.id, old!.id);
    expect((await svc.riderAddresses(ctx('grade'), r.id)).map((a) => a.id)).toEqual([current!.id]);
  });
  // Task D (owner, 2026-10-08): deleting the CURRENT address is now allowed — the rider stays on
  // tonight's run but with no place at all, and is taken out of any car. A later Generate must
  // leave them unassigned (never auto-placed with no map pin) — see bus.generate.test.ts.
  it('deleting the current address clears the rider\'s place and car, leaving them on the run', async () => {
    const t = await withFleet();
    const moved = await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    expect(moved.runVehicleId).toBe(t.rvId);
    const current = (await t.svc.riderAddresses(t.ctx('grade'), t.a.id))[0]!;
    await t.svc.deleteRiderAddress(t.ctx('grade'), t.a.id, current.id);
    const v = await t.svc.getRun(t.ctx('admin'));
    const after = v.riders.find((r) => r.id === t.a.id)!;
    expect(after).toMatchObject({ addressId: null, placeId: null, address: '', runVehicleId: null, stopOrder: null, pinned: false });
    expect(await t.bus.getAddress(current.id)).toBeNull();
  });
  it('is blocked by an active lock, like other rider writes', async () => {
    const { svc, bus, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } });
    const runId = (await svc.getRun(ctx('admin'))).run.id;
    await bus.tryLock(runId, 'someone#tok', new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
    await expect(svc.deleteRiderAddress(ctx('grade'), r.id, r.addressId!)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('Task A: saveMyCarStops — "Edit my car" reorder/remove', () => {
  // withFleet's "Big Bus" has 1 leader and 3 seats = 2 youth seats — the ctx() helper's asLeaderId
  // is ignored for role 'leader' (selfLeaderId reads actor.leaderId instead, by design: a junior
  // leader login is locked to its own record), so these use the same actor('leader', { leaderId })
  // pattern the existing "My car only" test (line ~444) already uses.
  const leaderCtx = (id: string): BusCtx => ({ actor: actor('leader', { leaderId: id }), asLeaderId: null, localNow: FRI_7PM });
  it('reorders a fleet car\'s stops in exactly the order given', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    await t.svc.moveRider(t.ctx('quad'), t.b.id, { runVehicleId: t.rvId });
    const rv = await t.svc.saveMyCarStops(leaderCtx('L1'), { riderIds: [t.b.id, t.a.id], removeIds: [] });
    expect(rv.id).toBe(t.rvId);
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.riders.find((r) => r.id === t.b.id)).toMatchObject({ stopOrder: 1, pinned: true, runVehicleId: t.rvId });
    expect(v.riders.find((r) => r.id === t.a.id)).toMatchObject({ stopOrder: 2, pinned: true, runVehicleId: t.rvId });
  });
  it('optimiseMyCar re-solves the acting leader car; 404 for a leader not on a car', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    await t.svc.moveRider(t.ctx('quad'), t.b.id, { runVehicleId: t.rvId });
    const opt = await t.svc.optimiseMyCar(leaderCtx('L1'));
    expect(opt.id).toBe(t.rvId);
    expect(typeof opt.optimised).toBe('boolean');
    const orders = (await t.svc.getRun(t.ctx('admin'))).riders.filter((r) => r.runVehicleId === t.rvId).map((r) => r.stopOrder).sort();
    expect(orders).toEqual([1, 2]);
    await expect(t.svc.optimiseMyCar(leaderCtx('nobody'))).rejects.toMatchObject({ statusCode: 404 });
  });
  it('optimiseMyCar keeps dropped-off riders first and does not re-sequence them', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    await t.svc.moveRider(t.ctx('quad'), t.b.id, { runVehicleId: t.rvId });
    await t.svc.saveMyCarStops(leaderCtx('L1'), { riderIds: [t.b.id, t.a.id], removeIds: [] });
    await t.svc.setDropped(t.ctx('quad'), t.b.id, { dropped: true });
    await t.svc.optimiseMyCar(leaderCtx('L1'));
    const riders = (await t.svc.getRun(t.ctx('admin'))).riders;
    expect(riders.find((r) => r.id === t.b.id)!.stopOrder).toBe(1);
    expect(riders.find((r) => r.id === t.a.id)!.stopOrder).toBe(2);
  });
  it('removes a rider from the car; an unlinked guest removed this way is not deleted and reappears in Past riders', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: null });
    const gr = await t.svc.addRider(t.ctx('grade'), { guestId: g.id, newAddress: { address: '9 G St, Bulimba', placeId: 'fake:9-g-st' } });
    await t.svc.moveRider(t.ctx('quad'), gr.id, { runVehicleId: t.rvId });
    await t.svc.saveMyCarStops(leaderCtx('L1'), { riderIds: [t.a.id], removeIds: [gr.id] });
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.riders.find((r) => r.id === gr.id)).toBeUndefined(); // off tonight's run
    expect(await t.bus.getGuest(g.id)).not.toBeNull(); // not hard-deleted, unlike removeRider's orphan path
    expect(v.pastRiders.map((p) => p.guestId)).toContain(g.id); // reappears in Students tab Past riders
  });
  it('also works for the leader\'s own (manually added) car', async () => {
    const t = await setup();
    const own = await t.svc.saveOwnCar(t.ctx('grade', 'L2'), { car: { name: "Sarah's car", seats: 5, endsAt: 'church' },
      riderIds: [], newRiders: [{ studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } },
        { studentId: 's2', newAddress: { address: '2 B St, Bulimba', placeId: 'fake:2-b-st-bulimba' } }] });
    const before = (await t.svc.getRun(t.ctx('admin'))).riders;
    const r1 = before.find((r) => r.studentId === 's1')!, r2 = before.find((r) => r.studentId === 's2')!;
    await t.svc.saveMyCarStops(t.ctx('grade', 'L2'), { riderIds: [r2.id, r1.id], removeIds: [] });
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.riders.find((r) => r.id === r2.id)).toMatchObject({ stopOrder: 1, runVehicleId: own.id });
    expect(v.riders.find((r) => r.id === r1.id)).toMatchObject({ stopOrder: 2, runVehicleId: own.id });
  });
  it('404s for a leader not on any car', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    await expect(t.svc.saveMyCarStops(leaderCtx('L2'), { riderIds: [t.a.id], removeIds: [] })).rejects.toMatchObject({ statusCode: 404 });
  });
  it('a mismatched id set (car changed under them) is rejected with 409', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    await t.svc.moveRider(t.ctx('quad'), t.b.id, { runVehicleId: t.rvId });
    await expect(t.svc.saveMyCarStops(leaderCtx('L1'), { riderIds: [t.a.id], removeIds: [] })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('is blocked by an active lock', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    const runId = (await t.svc.getRun(t.ctx('admin'))).run.id;
    await t.bus.tryLock(runId, 'someone#tok', new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
    await expect(t.svc.saveMyCarStops(leaderCtx('L1'), { riderIds: [t.a.id], removeIds: [] })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('Task C: deletePastRider — trash a Past riders row', () => {
  it('deletes a student\'s saved addresses, dropping them out of Past riders', async () => {
    const { svc, bus, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } });
    await svc.removeRider(ctx('grade'), r.id);
    expect((await svc.getRun(ctx('admin'))).pastRiders.map((p) => p.studentId)).toEqual(['s1']);
    await svc.deletePastRider(ctx('grade'), { studentId: 's1' });
    expect((await svc.getRun(ctx('admin'))).pastRiders).toEqual([]);
    expect(await bus.listAddresses({ studentId: 's1' })).toHaveLength(0);
  });
  it('also deletes an unlinked guest no longer on tonight; a linked one is kept', async () => {
    const { svc, bus, ctx } = await setup();
    const g = await svc.createGuest(ctx('grade'), { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: null });
    const r = await svc.addRider(ctx('grade'), { guestId: g.id, newAddress: { address: '3 C St, Wynnum', placeId: 'fake:3-c-st' } });
    await svc.removeRider(ctx('grade'), r.id);
    await svc.deletePastRider(ctx('grade'), { guestId: g.id });
    expect(await bus.getGuest(g.id)).toBeNull();
  });
  it('refuses (400) when the person is on tonight\'s run', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina', placeId: 'fake:1-a-st-carina' } });
    await expect(svc.deletePastRider(ctx('grade'), { studentId: 's1' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('needs exactly one of studentId/guestId', async () => {
    const { svc, ctx } = await setup();
    await expect(svc.deletePastRider(ctx('grade'), {})).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('personAddresses — Past riders confirm sheet', () => {
  it('lists a student\'s saved addresses, most recently used first; needs exactly one id', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Mum', address: '24 Wynnum Rd, Carina QLD 4152, Australia', placeId: 'fake:24-wynnum-rd-carina-qld-' } });
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Dad', address: '3 Lindsay Ct, Cornubia QLD 4130, Australia', placeId: 'fake:3-lindsay-ct-cornubia-qld-' } });
    const addrs = await svc.personAddresses(ctx('grade'), { studentId: 's1' });
    expect(addrs.map((a) => a.label).sort()).toEqual(['Dad', 'Mum']);
    await expect(svc.personAddresses(ctx('grade'), {})).rejects.toMatchObject({ statusCode: 400 });
  });
});
