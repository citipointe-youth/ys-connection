// BUS-2 Charter bus (2026-10-18): a fleet vehicle with kind 'bus' is a charter to its ends address.
import { describe, it, expect } from 'vitest';
import { busFixture, recordingRouting } from './helpers/bus-fixtures';

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
  it('tonight copy carries kind; next week too', async () => {
    const f = await busFixture();
    const { vehicleId } = await busCar(f);
    expect((await f.svc.getRun(f.admin)).vehicles.find((x) => x.vehicleId === vehicleId)!.kind).toBe('bus');
    const next = { ...f.admin, localNow: '2026-10-16T19:00' };
    expect((await f.svc.getRun(next)).vehicles.find((x) => x.vehicleId === vehicleId)!.kind).toBe('bus');
  });
  it.skip('no female-leader flag on a bus', async () => {
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
  it.skip('car→bus conversion: riders with home addresses leave it', async () => {
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
