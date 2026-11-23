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


// Y3-1: the write routes reply with the same redaction getRun applies.
describe('Y3-1: a junior login gets no address from the drop-off and vehicle write routes', () => {
  const ADDR = '12 Driver St, Testville QLD';
  async function fleetWorld() {
    const w = await world();
    const fleet = await w.svc.saveVehicle(w.admin, { name: 'Tom car', seats: 5, endsAt: 'address', endsAddress: ADDR, endsPlaceId: 'fake:drv' });
    const rv = (await w.svc.getRun(w.admin)).vehicles.find((x) => x.vehicleId === fleet.id)!;
    await w.svc.updateRunVehicle(w.admin, rv.id, { leaderIds: ['L1'] });
    await w.svc.moveRider(w.admin, w.a.id, { runVehicleId: rv.id });
    return { ...w, fleet, rvId: rv.id };
  }
  const suburbOnlyShape = (r: { address: string; placeId: string | null; studentId: string | null; guestId: string | null; addressId: string | null }) => {
    expect(r.address).not.toContain('Test St');
    expect([r.placeId, r.studentId, r.guestId, r.addressId]).toEqual([null, null, null, null]);
  };

  it('setDropped on a rider in another car is suburb-only; the call still resolves', async () => {
    const w = await fleetWorld();
    suburbOnlyShape(await w.svc.setDropped(jr(), w.a.id, { dropped: true }));
  });
  it('updateRunVehicle hides the end address on a car the junior is not on, keeps it on its own', async () => {
    const w = await fleetWorld();
    const other = await w.svc.updateRunVehicle(jr(), w.rvId, {});
    expect([other.endsAddress, other.endsPlaceId]).toEqual([null, null]);
    await w.svc.updateRunVehicle(w.admin, w.rvId, { leaderIds: ['L1', 'L3'] });
    const own = await w.svc.updateRunVehicle(jr(), w.rvId, {});
    expect([own.endsAddress, own.endsPlaceId]).toEqual([ADDR, 'fake:drv']);
  });
  it('saveVehicle replies (resend and real save) carry no end address for a junior', async () => {
    const w = await fleetWorld();
    const resend = await w.svc.saveVehicle(jr(), { requestId: w.fleet.id, name: w.fleet.name, seats: 5, endsAt: 'church' });
    expect([resend.endsAddress, resend.endsPlaceId]).toEqual([null, null]);
    const saved = await w.svc.saveVehicle(jr(), { name: 'New car', seats: 4, endsAt: 'address', endsAddress: '5 Sample Rd, Dummyton QLD', endsPlaceId: 'fake:new' });
    expect([saved.endsAddress, saved.endsPlaceId]).toEqual([null, null]);
  });
  it('pin: a grade login gets the full values from all three', async () => {
    const w = await fleetWorld();
    const g = w.ctx('grade', 'L2');
    const d = await w.svc.setDropped(g, w.a.id, { dropped: true });
    expect(d.address).toContain('Test St');
    expect(d.placeId).toBe('fake:s1');
    expect((await w.svc.updateRunVehicle(g, w.rvId, {})).endsAddress).toBe(ADDR);
    expect((await w.svc.saveVehicle(g, { requestId: w.fleet.id, name: w.fleet.name, seats: 5, endsAt: 'church' })).endsAddress).toBe(ADDR);
  });
  it('a junior who is a coordinator gets full values; a junior\'s own-car rider is still suburb-only on setDropped', async () => {
    const w = await fleetWorld();
    await coordinators(w, ['L3']);
    expect((await w.svc.setDropped(jr(), w.a.id, { dropped: true })).address).toContain('Test St');
    expect((await w.svc.updateRunVehicle(jr(), w.rvId, {})).endsAddress).toBe(ADDR);
    expect((await w.svc.saveVehicle(jr(), { requestId: w.fleet.id, name: w.fleet.name, seats: 5, endsAt: 'church' })).endsAddress).toBe(ADDR);
    // back to a plain junior: its own car's rider is still suburb-only
    const w2 = await world();
    const own = await w2.svc.saveOwnCar(jr(), { car, riderIds: [w2.b.id] });
    expect(own.id).toBeTruthy();
    suburbOnlyShape(await w2.svc.setDropped(jr(), w2.b.id, { dropped: true }));
  });
});
