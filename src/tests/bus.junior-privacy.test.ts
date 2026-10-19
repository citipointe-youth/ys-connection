// r19 lane Y3: the junior "My car only" leader must not reach other riders' addresses/phones
// through Car setup (SY-03) or My car (SY-04), and a finished bus night is not rewritable
// through ?date= by bus:use logins (SY-05 = CY-C2).
import { describe, it, expect } from 'vitest';
import { busFixture, FRI_7PM } from './helpers/bus-fixtures';
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

