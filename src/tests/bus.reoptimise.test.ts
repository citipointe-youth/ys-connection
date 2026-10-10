import { describe, it, expect } from 'vitest';
import { busFixture, recordingRouting, stubRouting } from './helpers/bus-fixtures';
import { RoutingError } from '../services/routing/routing-provider';

// Re-optimising whenever someone is assigned to a car (dropped riders fixed + sequence from the last
// drop-off), plus the Past night popup map.
const WK2 = '2026-10-16T19:00';

describe('re-optimise with dropped riders', () => {
  it('moveRider sequences the rest from the last drop-off, not the church, and reports reordered', async () => {
    const { provider, calls } = recordingRouting();
    const f = await busFixture({ routing: provider });
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1'), b = await f.rider('s2'), c = await f.rider('s3');
    await f.svc.moveRider(f.admin, a.id, { runVehicleId: rv });
    await f.svc.moveRider(f.admin, b.id, { runVehicleId: rv });
    await f.svc.setDropped(f.admin, a.id, { dropped: true });
    calls.solve.length = 0;
    const moved = await f.svc.moveRider(f.admin, c.id, { runVehicleId: rv });
    expect(moved.reordered).toBe(true);
    expect(calls.solve.at(-1)!.vehicles[0]!.start.placeId).toBe('fake:s1'); // a's address, not 'fake:church'
    expect(calls.solve.at(-1)!.stops).toHaveLength(2);
    const riders = (await f.svc.getRun(f.admin)).riders;
    expect(riders.find((r) => r.id === a.id)!.stopOrder).toBe(1);
  });

  it('moveRider reports reordered:false when Google is down, but the move still happens', async () => {
    const f = await busFixture({ routing: stubRouting({ solve: async () => { throw new RoutingError('down'); } }) });
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1'), b = await f.rider('s2');
    await f.svc.moveRider(f.admin, a.id, { runVehicleId: rv });
    const moved = await f.svc.moveRider(f.admin, b.id, { runVehicleId: rv });
    expect(moved).toMatchObject({ runVehicleId: rv, reordered: false });
  });

  it('changing the address of a rider in a car re-orders that car', async () => {
    const { provider, calls } = recordingRouting();
    const f = await busFixture({ routing: provider });
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1'), b = await f.rider('s2');
    await f.svc.moveRider(f.admin, a.id, { runVehicleId: rv });
    await f.svc.moveRider(f.admin, b.id, { runVehicleId: rv });
    const before = calls.solve.length;
    await f.svc.updateRider(f.admin, a.id, { newAddress: { address: '5 New St, Newtown', placeId: 'fake:new-a' } });
    expect(calls.solve.length).toBe(before + 1);
    expect(calls.solve.at(-1)!.stops.map((s) => s.point.placeId).sort()).toEqual(['fake:new-a', 'fake:s2']);
  });

  it('Generate never moves a dropped rider to another car, keeps them first, and leaves pinned as saved', async () => {
    const f = await busFixture();
    const c1 = await f.car('Van A', 8, ['L1', 'L2']); await f.car('Van B', 8, ['L3', 'L4']);
    const riders = [];
    for (const s of ['s1', 's2', 's3', 's4']) riders.push(await f.rider(s));
    await f.svc.generate(f.admin, { mode: 'all' });
    const dropped = (await f.svc.getRun(f.admin)).riders.find((r) => r.runVehicleId === c1) ?? null;
    // force a known state: s3 sits in car A, unpinned, already dropped
    const s3 = riders[2]!;
    const row = (await f.bus.getRunRider(s3.id))!;
    await f.bus.saveRunRider({ ...row, runVehicleId: c1, stopOrder: 5, pinned: false, droppedAt: '2026-10-09T10:00:00.000Z' });
    void dropped;
    for (const mode of ['all', 'fit'] as const) {
      await f.svc.generate(f.admin, { mode });
      const after = (await f.bus.getRunRider(s3.id))!;
      expect(after).toMatchObject({ runVehicleId: c1, pinned: false, stopOrder: 1 });
    }
  });

  it('Unassign all leaves dropped-off riders in their car', async () => {
    const f = await busFixture();
    const a = await f.car('Van', 8, ['L1', 'L2']);
    const r1 = await f.rider('s1'); await f.rider('s2');
    await f.svc.generate(f.admin, { mode: 'all' });
    await f.svc.setDropped(f.admin, r1.id, { dropped: true });
    expect(await f.svc.unassignAll(f.admin)).toEqual({ unassigned: 1 });
    expect((await f.bus.getRunRider(r1.id))!.runVehicleId).toBe(a);
  });
});

describe('pastRunMap', () => {
  async function setup() {
    const { provider, calls } = recordingRouting();
    const f = await busFixture({ routing: provider });
    const at = (role: string) => ({ ...f.ctx(role), localNow: WK2 });
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1'), b = await f.rider('s2'), c = await f.rider('s3');
    for (const r of [a, b, c]) await f.svc.moveRider(f.admin, r.id, { runVehicleId: rv });
    const runId = (await f.svc.history(at('admin'))).nights[0]!.id;
    return { f, at, calls, runId, a, b, c };
  }

  it('draws one route per car through its placed stops in stop order, and caches per run version', async () => {
    const { f, at, calls, runId, b } = await setup();
    const row = (await f.bus.getRunRider(b.id))!;
    await f.bus.saveRunRider({ ...row, noShow: true }); // no-shows are not driven to
    const img = await f.svc.pastRunMap(at('admin'), runId);
    expect(img.contentType).toBe('image/svg+xml');
    expect(calls.route).toHaveLength(1);
    expect(calls.route[0]!.map((p) => p.placeId)).toHaveLength(1 + 2 + 1); // church, 2 stops, back to church
    expect(calls.route[0]![0]!.placeId).toBe('fake:church');
    expect(calls.map[0]!.markers).toHaveLength(2);
    await f.svc.pastRunMap(at('admin'), runId);
    expect(calls.route).toHaveLength(1); // cached
    // a logged past edit bumps the run version → fresh map
    await f.svc.editPastRider(at('admin'), runId, b.id, { noShow: false });
    await f.svc.pastRunMap(at('admin'), runId);
    expect(calls.route).toHaveLength(2);
  });

  it('404 for an unknown night; 403 for a grade login; 400 when nobody is routable', async () => {
    const { f, at, runId } = await setup();
    await expect(f.svc.pastRunMap(at('admin'), 'nope')).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.svc.pastRunMap(at('grade'), runId)).rejects.toMatchObject({ statusCode: 403 });
    const g = await busFixture();
    const rv = await g.car('Bus', 8, ['L1']);
    const r = await g.rider('s1', null); // no map pin
    await g.svc.moveRider(g.admin, r.id, { runVehicleId: rv });
    const id = (await g.svc.history({ ...g.admin, localNow: WK2 })).nights[0]!.id;
    await expect(g.svc.pastRunMap({ ...g.admin, localNow: WK2 }, id)).rejects.toMatchObject({ statusCode: 400 });
  });
});
