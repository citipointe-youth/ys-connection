// BUS-2 Charter bus (2026-10-18): a fleet vehicle with kind 'bus' is a charter to its ends address.
import { describe, it, expect } from 'vitest';
import { busFixture, recordingRouting } from './helpers/bus-fixtures';

/** lastUsedAt is ms-resolution: step past it so "most recently used" is never a same-ms tie in a test. */
const tick = () => new Promise((r) => setTimeout(r, 3));
const DROP = { endsAt: 'address' as const, endsAddress: '9 Hall St, Carina QLD', endsPlaceId: 'fake:hall' };
async function busCar(f: Awaited<ReturnType<typeof busFixture>>, seats = 10, leaderIds: string[] = ['L1']) {
  const v = await f.svc.saveVehicle(f.admin, { name: 'Charter', seats, kind: 'bus', ...DROP });
  const rv = (await f.svc.getRun(f.admin)).vehicles.find((x) => x.vehicleId === v.id)!;
  await f.svc.updateRunVehicle(f.admin, rv.id, { leaderIds });
  return { vehicleId: v.id, rvId: rv.id };
}

describe('BUS-2 vehicle kind', () => {
  it('a bus needs its drop-off address', async () => {
    const f = await busFixture();
    await expect(f.svc.saveVehicle(f.admin, { name: 'B', seats: 20, kind: 'bus', endsAt: 'church' })).rejects.toThrow(/drop-off address/);
    const { rvId } = await busCar(f);
    await expect(f.svc.updateRunVehicle(f.admin, rvId, { endsAt: 'church' })).rejects.toThrow(/drop-off address/);
  });
  it('a car is still a car (kind defaults)', async () => {
    const f = await busFixture();
    const carId = await f.car('Van', 8, ['L1']);
    expect((await f.svc.getRun(f.admin)).vehicles.find((x) => x.id === carId)!.kind).toBe('car');
  });
  it('review M2: a save with no kind (old cached SPA) keeps a bus a bus; an explicit car still demotes', async () => {
    const f = await busFixture();
    const { vehicleId, rvId } = await busCar(f);
    const saved = await f.svc.saveVehicle(f.admin, { id: vehicleId, name: 'Charter 2', seats: 12, ...DROP });
    expect(saved.kind).toBe('bus');
    expect((await f.svc.getRun(f.admin)).vehicles.find((x) => x.id === rvId)!.kind).toBe('bus');
    await expect(f.svc.saveVehicle(f.admin, { id: vehicleId, name: 'Charter 2', seats: 12, endsAt: 'church' })).rejects.toThrow(/drop-off address/);
    expect((await f.svc.saveVehicle(f.admin, { id: vehicleId, name: 'Van', seats: 8, endsAt: 'church', kind: 'car' })).kind).toBe('car');
  });
  it('tonight copy carries kind; next week too', async () => {
    const f = await busFixture();
    const { vehicleId } = await busCar(f);
    expect((await f.svc.getRun(f.admin)).vehicles.find((x) => x.vehicleId === vehicleId)!.kind).toBe('bus');
    const next = { ...f.admin, localNow: '2026-10-16T19:00' };
    expect((await f.svc.getRun(next)).vehicles.find((x) => x.vehicleId === vehicleId)!.kind).toBe('bus');
  });
  it('no female-leader flag on a bus', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f, 10, ['L1']); // male leader only
    await f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId }); // s1 = girl
    expect((await f.svc.getRun(f.admin)).vehicles.find((x) => x.id === rvId)!.needsFemaleLeader).toBe(false);
  });
  it('generate never sends the bus or its riders to the solver, and works with only a bus running', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    const { rvId } = await busCar(f);
    await f.rider('s2'); // home address, no car
    const res = await f.svc.generate(f.admin, { mode: 'all' }); // must not throw "Turn on at least one car"
    expect(res.unassigned).toBe(1);
    const carId = await f.car('Van', 8, ['L2', 'L4']);
    await f.svc.generate(f.admin, { mode: 'all' });
    const p = rec.calls.solve.at(-1)!;
    expect(p.vehicles).toHaveLength(1); // the van only
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.find((r) => r.studentId === 's2')!.runVehicleId).toBe(carId);
    expect(v.vehicles.find((x) => x.id === rvId)!.kind).toBe('bus');
  });
  it('pool auto-fill still gives a bus a leader', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f, 20, []);
    await f.svc.setPool(f.admin, { availableLeaderIds: ['L3'] });
    await f.svc.generate(f.admin, { mode: 'all' });
    expect((await f.svc.getRun(f.admin)).vehicles.find((x) => x.id === rvId)!.leaderIds).toContain('L3');
  });
  it('car→bus conversion: riders with home addresses leave it', async () => {
    const f = await busFixture();
    const carId = await f.car('Van', 8, ['L1'], { endsAt: 'church' });
    const r = await f.rider('s2');
    await f.svc.moveRider(f.admin, r.id, { runVehicleId: carId });
    const vid = (await f.svc.getRun(f.admin)).vehicles.find((x) => x.id === carId)!.vehicleId!;
    await f.svc.saveVehicle(f.admin, { id: vid, name: 'Van', seats: 8, kind: 'bus', ...DROP });
    const v = await f.svc.getRun(f.admin);
    expect(v.vehicles.find((x) => x.id === carId)).toMatchObject({ kind: 'bus', endsAt: 'address', endsPlaceId: 'fake:hall' });
    expect(v.riders.find((x) => x.id === r.id)!.runVehicleId).toBeNull();
  });
});

describe('BUS-2 bus drop-off choice', () => {
  const NEXT = '2026-10-16T19:00';
  it('choosing the bus seats them on it at the drop-off, even over capacity', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f, 2, ['L1']); // capacity 1
    for (const s of ['s1', 's2']) await f.svc.addRider(f.admin, { studentId: s, busRunVehicleId: rvId });
    const v = await f.svc.getRun(f.admin);
    const on = v.riders.filter((r) => r.runVehicleId === rvId);
    expect(on).toHaveLength(2); // over capacity, nobody moved
    expect(on.every((r) => r.pinned && r.placeId === 'fake:hall' && r.address === DROP.endsAddress)).toBe(true);
  });
  it('a bus that is not running is refused', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    await f.svc.updateRunVehicle(f.admin, rvId, { running: false });
    await expect(f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId })).rejects.toThrow(/isn't running tonight/);
  });
  it('exactly one of addressId / newAddress / busRunVehicleId', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    await expect(f.svc.addRider(f.admin, { studentId: 's1' })).rejects.toThrow(/Choose an address/);
    await expect(f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId, addressId: 'x' })).rejects.toThrow(/Choose an address/);
  });
  it('remembered next week: Past riders addressId puts them back on the bus', async () => {
    const f = await busFixture();
    await f.rider('s1'); // home address first
    const { rvId } = await busCar(f);
    await tick();
    await f.svc.updateRider(f.admin, (await f.svc.getRun(f.admin)).riders[0]!.id, { busRunVehicleId: rvId });
    const next = { ...f.admin, localNow: NEXT };
    const past = (await f.svc.getRun(next)).pastRiders.find((p) => p.studentId === 's1')!;
    expect(past.suburb).toBe('Bus drop off');
    await f.svc.addRider(next, { studentId: 's1', addressId: past.addressId });
    const v = await f.svc.getRun(next);
    const busRv = v.vehicles.find((x) => x.kind === 'bus')!;
    expect(v.riders[0]!.runVehicleId).toBe(busRv.id);
  });
  it('bus off next week → their home address, choice still remembered', async () => {
    const f = await busFixture();
    await f.rider('s1');
    const { rvId } = await busCar(f);
    const rid = (await f.svc.getRun(f.admin)).riders[0]!.id;
    await f.svc.updateRider(f.admin, rid, { busRunVehicleId: rvId });
    const next = { ...f.admin, localNow: NEXT };
    const nextBus = (await f.svc.getRun(next)).vehicles.find((x) => x.kind === 'bus')!;
    await f.svc.updateRunVehicle(next, nextBus.id, { running: false });
    const past = (await f.svc.getRun(next)).pastRiders.find((p) => p.studentId === 's1')!;
    await f.svc.addRider(next, { studentId: 's1', addressId: past.addressId });
    const r = (await f.svc.getRun(next)).riders[0]!;
    expect(r.runVehicleId).toBeNull();
    expect(r.placeId).toBe('fake:s1'); // home
    expect(r.addressId).toBe(past.addressId); // still the bus choice
  });
  it('bus row, bus off, no home address → refused', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    await f.svc.addRider(f.admin, { studentId: 's3', busRunVehicleId: rvId });
    const next = { ...f.admin, localNow: NEXT };
    const nextBus = (await f.svc.getRun(next)).vehicles.find((x) => x.kind === 'bus')!;
    await f.svc.updateRunVehicle(next, nextBus.id, { running: false });
    const past = (await f.svc.getRun(next)).pastRiders.find((p) => p.studentId === 's3')!;
    await expect(f.svc.addRider(next, { studentId: 's3', addressId: past.addressId })).rejects.toThrow(/home address/);
  });
  it('sync on running toggle: off → home + Unassigned (no pin if no home); on → back on the bus', async () => {
    const f = await busFixture();
    await f.rider('s1');
    const { rvId } = await busCar(f);
    const rid = (await f.svc.getRun(f.admin)).riders[0]!.id;
    await f.svc.updateRider(f.admin, rid, { busRunVehicleId: rvId });
    await f.svc.addRider(f.admin, { studentId: 's3', busRunVehicleId: rvId }); // no home address
    await f.svc.updateRunVehicle(f.admin, rvId, { running: false });
    let v = await f.svc.getRun(f.admin);
    expect(v.riders.find((r) => r.id === rid)).toMatchObject({ runVehicleId: null, placeId: 'fake:s1' });
    expect(v.riders.find((r) => r.studentId === 's3')).toMatchObject({ runVehicleId: null, placeId: null });
    await f.svc.updateRunVehicle(f.admin, rvId, { running: true });
    v = await f.svc.getRun(f.admin);
    expect(v.riders.filter((r) => r.runVehicleId === rvId)).toHaveLength(2);
  });
  it('ends change re-snaps every bus rider', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    await f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId });
    await f.svc.updateRunVehicle(f.admin, rvId, { endsAt: 'address', endsAddress: '1 Park Rd, Wynnum', endsPlaceId: 'fake:park' });
    expect((await f.svc.getRun(f.admin)).riders[0]).toMatchObject({ placeId: 'fake:park', address: '1 Park Rd, Wynnum' });
  });
  it('picking a home address takes them off the bus', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    const r = await f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId });
    await f.svc.updateRider(f.admin, r.id, { newAddress: { label: '', address: '1 Home St, Carina', placeId: 'fake:home' } });
    expect((await f.svc.getRun(f.admin)).riders[0]).toMatchObject({ runVehicleId: null, placeId: 'fake:home' });
  });
  it('address lists flag the bus row; junior search still has none', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    const r = await f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId });
    const hit = (await f.svc.search(f.admin, 'Jess'))[0]!;
    expect(hit.addresses[0]).toMatchObject({ label: 'Bus drop off', suburb: 'Bus drop off', street: 'Bus drop off' });
    expect(hit.addresses[0]!.vehicleId).toBeTruthy();
    expect((await f.svc.riderAddresses(f.admin, r.id))[0]!.vehicleId).toBeTruthy();
    expect((await f.svc.personAddresses(f.admin, { studentId: 's1' }))[0]!.label).toBe('Bus drop off');
    expect((await f.svc.search(f.ctx('leader', 'L1'), 'Jess')).flatMap((h) => h.addresses)).toEqual([]);
  });
});

describe('BUS-2 move + history', () => {
  it('Move onto a full bus is allowed and becomes their choice', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f, 1, ['L1']); // capacity 0
    const r = await f.rider('s2');
    await tick();
    await f.svc.moveRider(f.admin, r.id, { runVehicleId: rvId });
    const got = (await f.svc.getRun(f.admin)).riders[0]!;
    expect(got).toMatchObject({ runVehicleId: rvId, placeId: 'fake:hall', pinned: true });
    expect((await f.svc.search(f.admin, 'Sam'))[0]!.addresses[0]!.label).toBe('Bus drop off');
  });
  it('Move off the bus goes back to the home address; no home → 400', async () => {
    const f = await busFixture();
    await f.rider('s1');
    const { rvId } = await busCar(f);
    const carId = await f.car('Van', 8, ['L2']);
    const rid = (await f.svc.getRun(f.admin)).riders[0]!.id;
    await f.svc.updateRider(f.admin, rid, { busRunVehicleId: rvId });
    await f.svc.moveRider(f.admin, rid, { runVehicleId: carId });
    expect((await f.svc.getRun(f.admin)).riders[0]).toMatchObject({ runVehicleId: carId, placeId: 'fake:s1' });
    const r3 = await f.svc.addRider(f.admin, { studentId: 's3', busRunVehicleId: rvId });
    await expect(f.svc.moveRider(f.admin, r3.id, { runVehicleId: null })).rejects.toThrow(/home address first/);
  });
  it('Unassign all and Undo leave bus riders on the bus', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    await f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId });
    await f.svc.generate(f.admin, { mode: 'all' });
    await f.svc.unassignAll(f.admin);
    expect((await f.svc.getRun(f.admin)).riders[0]!.runVehicleId).toBe(rvId);
  });
  it('Past marks the bus', async () => {
    const f = await busFixture();
    const { rvId } = await busCar(f);
    await f.svc.addRider(f.admin, { studentId: 's1', busRunVehicleId: rvId });
    const h = await f.svc.history({ ...f.admin, localNow: '2026-10-16T19:00' });
    expect(h.rides[0]!.car).toBe('Charter (bus)');
  });
});
