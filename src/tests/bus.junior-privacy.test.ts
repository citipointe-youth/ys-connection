// r19 lane Y3: the junior "My car only" leader must not reach other riders' addresses/phones
// through Car setup (SY-03) or My car (SY-04), and a finished bus night is not rewritable
// through ?date= by bus:use logins (SY-05 = CY-C2).
import { describe, it, expect } from 'vitest';
import { busFixture, FRI_7PM } from './helpers/bus-fixtures';
import { riderKey } from '../services/bus-logic';
import type { BusCtx } from '../services/bus.service';
import type { Actor } from '../core/entities/user';

const T = '2026-01-01T00:00:00.000Z';
const WED = '2026-10-14T19:00'; // last bus night = Fri 2026-10-09
const jr = (localNow = FRI_7PM, tripDate: string | null = null, leaderId = 'L3'): BusCtx => ({
  actor: { id: 'u-jr', role: 'leader', displayName: 'JR', grade: null, quad: null, leaderId } as unknown as Actor,
  asLeaderId: null, localNow, tripDate });
const car = { name: "Amy's car", seats: 5, endsAt: 'church' as const };

async function world() {
  const f = await busFixture();
  const rv = await f.car('Big Bus', 8, ['L1']);
  const a = await f.rider('s1'); // Unassigned, NOT L3's student
  const b = await f.rider('s2'); // L3's connected student
  await f.connections.save({ id: 'c1', studentId: 's2', leaderId: 'L3', assignedByRole: 'admin', createdAt: T });
  const ownCarOf = async (leaderId: string) => (await f.svc.getRun(f.admin)).vehicles.find((v) => v.ownerLeaderId === leaderId);
  return { ...f, rv, a, b, ownCarOf };
}
const coordinators = async (w: Awaited<ReturnType<typeof world>>, ids: string[]) => {
  const cur = (await w.settings.getSettings()).ministryConfig;
  await w.settings.updateSettings({ ministryConfig: { ...cur, busMinistry: { ...cur.busMinistry, coordinatorLeaderIds: ids } } });
};

describe('SY-03: a junior leader cannot put itself on a fleet car', () => {
  it('leaderIds change is 403 and the car is unchanged; other Car setup patches still work', async () => {
    const w = await world();
    await expect(w.svc.updateRunVehicle(jr(), w.rv, { leaderIds: ['L1', 'L3'] })).rejects.toMatchObject({ statusCode: 403 });
    expect((await w.svc.getRun(w.admin)).vehicles.find((v) => v.id === w.rv)!.leaderIds).toEqual(['L1']);
    expect((await w.svc.myCar(jr())).vehicle).toBeNull();
    await expect(w.svc.updateRunVehicle(jr(), w.rv, { running: true })).resolves.toBeTruthy();
  });
  it('grade login and a junior coordinator still set leaders', async () => {
    const w = await world();
    expect((await w.svc.updateRunVehicle(w.ctx('grade'), w.rv, { leaderIds: ['L1', 'L2'] })).leaderIds).toEqual(['L1', 'L2']);
    await coordinators(w, ['L3']);
    expect((await w.svc.updateRunVehicle(jr(), w.rv, { leaderIds: ['L3'] })).leaderIds).toEqual(['L3']);
  });
});

describe('SY-04: own-car save by a junior leader takes only its own riders', () => {
  it('an Unassigned rider who is not its student is refused; nothing is saved', async () => {
    const w = await world();
    await expect(w.svc.saveOwnCar(jr(), { car, riderIds: [w.a.id] })).rejects.toMatchObject({ statusCode: 403 });
    expect(await w.ownCarOf('L3')).toBeUndefined();
    expect((await w.bus.getRunRider(w.a.id))!.runVehicleId).toBeNull();
  });
  it('newRiders.studentId outside its connected students is refused before anything is created', async () => {
    const w = await world();
    for (const studentId of ['s1', 's4']) {
      await expect(w.svc.saveOwnCar(jr(), { car, riderIds: [], newRiders: [{ studentId }] })).rejects.toMatchObject({ statusCode: 403 });
    }
    const run = (await w.svc.getRun(w.admin)).run;
    expect((await w.bus.listRunRiders(run.id)).some((r) => r.studentId === 's4')).toBe(false);
    expect(await w.ownCarOf('L3')).toBeUndefined();
  });
  it('its own students (riderIds or newRiders) and riders already in its car are accepted', async () => {
    const w = await world();
    const own = await w.svc.saveOwnCar(jr(), { car, riderIds: [w.b.id] });
    // a coordinator puts s1 into the junior's car; the junior can re-save its car with them in it
    await w.svc.moveRider(w.admin, w.a.id, { runVehicleId: own.id });
    await expect(w.svc.saveOwnCar(jr(), { car, riderIds: [w.b.id, w.a.id] })).resolves.toBeTruthy();
    // newRiders with its own student also works (fresh login, s2 not yet on the run)
    const w2 = await world();
    await w2.svc.removeRider(w2.admin, w2.b.id);
    await expect(w2.svc.saveOwnCar(jr(), { car, riderIds: [], newRiders: [{ studentId: 's2' }] })).resolves.toBeTruthy();
  });
  it('grade/quad logins are unchanged: any rider, any student', async () => {
    const w = await world();
    const own = await w.svc.saveOwnCar(w.ctx('grade', 'L2'), { car, riderIds: [w.a.id], newRiders: [{ studentId: 's4' }] });
    expect((await w.svc.myCar(w.ctx('grade', 'L2'))).stops.map((s) => s.studentId).sort()).toEqual(['s1', 's4']);
    expect(own.ownerLeaderId).toBe('L2');
  });
  it('the own-car draft never pre-ticks a rider the junior could not save', async () => {
    const w = await world();
    const run = (await w.svc.getRun(w.admin)).run;
    const riders = await w.bus.listRunRiders(run.id);
    await w.bus.saveLeaderPrefs({ id: 'L3', inPool: false, ownCar: null, prefGrades: [], lastOwnRiderKeys: riders.map(riderKey) });
    expect((await w.svc.myCar(jr())).ownCarDraft!.riderIds).toEqual([w.b.id]);
    await w.bus.saveLeaderPrefs({ id: 'L2', inPool: false, ownCar: null, prefGrades: [], lastOwnRiderKeys: riders.map(riderKey) });
    expect((await w.svc.myCar(w.ctx('grade', 'L2'))).ownCarDraft!.riderIds.sort()).toEqual([w.a.id, w.b.id].sort());
  });
});

describe('SY-05 / CY-C2: a finished bus night is read-only through ?date= unless bus:analysis', () => {
  async function lastFriday() {
    const w = await world();
    const own = await w.svc.saveOwnCar(jr(), { car, riderIds: [w.b.id] }); // logged on the night
    return { ...w, own, past: jr(WED, '2026-10-09') };
  }
  it('every My car write on last Friday is 403 for the junior and for a grade login', async () => {
    const w = await lastFriday();
    const grade: BusCtx = { ...w.ctx('grade', 'L3'), localNow: WED, tripDate: '2026-10-09' };
    for (const who of [w.past, grade]) {
      await expect(w.svc.saveOwnCar(who, { car, riderIds: [w.b.id] })).rejects.toMatchObject({ statusCode: 403 });
      await expect(w.svc.saveMyCarStops(who, { riderIds: [], removeIds: [w.b.id] })).rejects.toMatchObject({ statusCode: 403 });
      await expect(w.svc.optimiseMyCar(who)).rejects.toMatchObject({ statusCode: 403 });
      await expect(w.svc.removeOwnCar(who)).rejects.toMatchObject({ statusCode: 403 });
      await expect(w.svc.setDropped(who, w.b.id, { dropped: true })).rejects.toMatchObject({ statusCode: 403 });
    }
    const r = (await w.bus.getRunRider(w.b.id))!;
    expect([r.runVehicleId, r.notRiding, r.droppedAt]).toEqual([w.own.id, false, null]);
    // reading it is still fine
    expect((await w.svc.myCar(w.past)).vehicle!.id).toBe(w.own.id);
  });
  it('a past bus night with no run is refused without creating one', async () => {
    const w = await world();
    await expect(w.svc.saveOwnCar(jr(WED, '2026-10-02'), { car, riderIds: [] })).rejects.toMatchObject({ statusCode: 403 });
    expect(await w.bus.getRunByDate('2026-10-02')).toBeNull();
  });
  it('director/admin (bus:analysis) can still correct it', async () => {
    const w = await lastFriday();
    const adm: BusCtx = { ...w.ctx('admin', 'L2'), localNow: WED, tripDate: '2026-10-09' };
    expect((await w.svc.setDropped(adm, w.b.id, { dropped: true })).droppedAt).toBeTruthy();
    await expect(w.svc.saveOwnCar({ ...w.ctx('director', 'L2'), localNow: WED, tripDate: '2026-10-09' }, { car, riderIds: [] })).resolves.toBeTruthy();
  });
  it('a past midweek trip stays open to the junior', async () => {
    const w = await world();
    const mon = jr(WED, '2026-10-12');
    await w.svc.saveOwnCar(mon, { car, riderIds: [], newRiders: [{ studentId: 's2' }] });
    const [r] = await w.bus.listRunRiders((await w.bus.getRunByDate('2026-10-12'))!.id);
    expect((await w.svc.setDropped(mon, r!.id, { dropped: true })).droppedAt).toBeTruthy();
  });
  it('setDropped.at is clamped to the night (any timezone): no other day can be written', async () => {
    const w = await world();
    expect((await w.svc.setDropped(w.admin, w.a.id, { dropped: true, at: '2026-10-01T00:00:00.000Z' })).droppedAt).toBe('2026-10-08T16:00:00.000Z');
    expect((await w.svc.setDropped(w.admin, w.a.id, { dropped: true, at: '2026-12-01T00:00:00.000Z' })).droppedAt).toBe('2026-10-10T18:00:00.000Z');
    expect((await w.svc.setDropped(w.admin, w.a.id, { dropped: true, at: '2026-10-09T11:42:00.000Z' })).droppedAt).toBe('2026-10-09T11:42:00.000Z');
  });
});
