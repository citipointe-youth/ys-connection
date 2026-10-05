import { describe, it, expect } from 'vitest';
import { busFixture, recordingRouting, stubRouting } from './helpers/bus-fixtures';
import { FakeRoutingProvider } from '../services/routing/fake-routing-provider';
import { RoutingError } from '../services/routing/routing-provider';
import { optimizeToursBody, autocompleteBody } from '../services/routing/google-requests';
import { mergeMinistryConfig } from '../core/ministry-config';

const future = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('generate', () => {
  it('places everyone within capacity, numbers stops 1..n, records undo, bumps version, releases the lock', async () => {
    const f = await busFixture();
    const a = await f.car('Van A', 8, ['L1', 'L2']); const b = await f.car('Van B', 8, ['L3', 'L4']);
    for (const s of ['s1', 's2', 's3', 's4']) await f.rider(s);
    const v0 = await f.svc.getRun(f.admin);
    const res = await f.svc.generate(f.admin, { mode: 'all' });
    expect(res).toMatchObject({ placed: 4, unassigned: 0, noAddressPin: 0 });
    const v = await f.svc.getRun(f.admin);
    expect(v.run.version).toBe(v0.run.version + 1);
    expect(v.run.lockBy).toBeNull();
    expect(v.run.undoUntil).not.toBeNull();
    for (const car of [a, b]) {
      const s = v.riders.filter((r) => r.runVehicleId === car).map((r) => r.stopOrder!).sort((x, y) => x - y);
      expect(s).toEqual(s.map((_, i) => i + 1));
    }
    expect(Object.keys(res.routeMin).every((id) => [a, b].includes(id))).toBe(true);
  });

  it('keeps pinned riders in their car; Fit in only places new riders', async () => {
    const f = await busFixture();
    await f.car('Van A', 8, ['L1', 'L2']); const b = await f.car('Van B', 8, ['L3', 'L4']);
    const jess = await f.rider('s1'); await f.rider('s2');
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: b });
    await f.svc.generate(f.admin, { mode: 'all' });
    let v = await f.svc.getRun(f.admin);
    const byName = (n: string) => v.riders.find((r) => r.name === n)!;
    expect(byName('Jess Tran')).toMatchObject({ runVehicleId: b, pinned: true });
    const samCar = byName('Sam Ode').runVehicleId;
    expect(samCar).not.toBeNull();
    await f.rider('s3');
    await f.svc.generate(f.admin, { mode: 'fit' });
    v = await f.svc.getRun(f.admin);
    expect(byName('Sam Ode').runVehicleId).toBe(samCar);
    expect(byName('Riley Kim').runVehicleId).not.toBeNull();
  });

  it('not enough seats: leftovers stay Unassigned', async () => {
    const f = await busFixture();
    await f.car('Small', 3, ['L1', 'L2']); // 1 youth seat
    await f.rider('s1'); await f.rider('s2');
    expect(await f.svc.generate(f.admin, { mode: 'all' })).toMatchObject({ placed: 1, unassigned: 1 });
  });

  it('pool auto-fill puts an available pool leader on a car with fewer than 2 leaders', async () => {
    const f = await busFixture();
    const a = await f.car('Van', 8, ['L1']);
    await f.rider('s1');
    await f.svc.setPool(f.admin, { availableLeaderIds: ['L2'] });
    await f.svc.generate(f.admin, { mode: 'all' });
    expect((await f.svc.getRun(f.admin)).vehicles.find((x) => x.id === a)!.leaderIds).toEqual(['L1', 'L2']);
  });

  it('own-car riders stay out of the fleet solve', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1'); await f.rider('s2');
    await f.svc.saveOwnCar(f.ctx('grade', 'L3'), { car: { name: "Amy's car", seats: 4, plate: null, endsAt: 'last_drop', endsAddress: null, endsPlaceId: null }, riderIds: [jess.id] });
    rec.calls.solve.length = 0;
    await f.svc.generate(f.admin, { mode: 'all' });
    expect(rec.calls.solve[0]!.stops).toHaveLength(1);
    const v = await f.svc.getRun(f.admin);
    expect(v.vehicles.find((x) => x.id === v.riders.find((r) => r.id === jess.id)!.runVehicleId)!.ownerLeaderId).toBe('L3');
  });

  it('a rider with no map pin is not sent to Google, keeps their seat and is counted', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    await f.car('Van', 8, ['L1', 'L2']);
    await f.rider('s1', null); await f.rider('s2');
    const res = await f.svc.generate(f.admin, { mode: 'all' });
    expect(rec.calls.solve[0]!.stops.map((s) => s.point.placeId)).toEqual(['fake:s2']);
    expect(res).toMatchObject({ placed: 1, noAddressPin: 1, unassigned: 1 });
  });

  it('no names, phones or grades in anything sent to Google', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    await f.car('Van', 8, ['L1', 'L2']);
    await f.rider('s1'); await f.rider('s2');
    await f.svc.generate(f.admin, { mode: 'all' });
    await f.svc.autocomplete(f.admin, '24 Wynnum Rd', 'sess-12345678');
    const sent = JSON.stringify([...rec.calls.solve.map(optimizeToursBody),
      ...rec.calls.autocomplete.map((c) => autocompleteBody(c.input, c.session, c.region))]);
    // Deviation from the brief: a plain substring check on 'Tran' false-positives against
    // optimizeToursBody's own "populateTransitionPolylines" key (Task 1 code, unrelated to the
    // rider's surname) — bound the match so it can't land inside an unrelated identifier.
    for (const pii of ['Jess', 'Tran', 'Sam', 'Ode', '0412345678', '0499888777', 'Tom', 'Sarah', 'Van'])
      expect(sent).not.toMatch(new RegExp(`(?<![A-Za-z0-9])${pii}(?![a-z])`));
    expect(sent).not.toMatch(/"(grade|gender|name|phone|mobile)"/i);
  });

  it('a second generate during a lock gets 409 naming who; Move is blocked too; an expired lock is taken over', async () => {
    const f = await busFixture();
    const a = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1');
    const run = (await f.svc.getRun(f.admin)).run;
    await f.bus.tryLock(run.id, 'Sarah', new Date().toISOString(), future(30_000));
    await expect(f.svc.generate(f.admin, { mode: 'all' })).rejects.toMatchObject({ statusCode: 409, message: 'Sarah is generating routes…' });
    await expect(f.svc.moveRider(f.admin, jess.id, { runVehicleId: a })).rejects.toMatchObject({ statusCode: 409 });
    const r = (await f.bus.getRun(run.id))!;
    await f.bus.saveRun({ ...r, lockUntil: new Date(Date.now() - 1000).toISOString() });
    await expect(f.svc.generate(f.admin, { mode: 'all' })).resolves.toMatchObject({ placed: 1 });
    expect((await f.bus.getRun(run.id))!.lockBy).toBeNull();
  });

  it('ticking pool availability during a generate keeps the lock', async () => {
    const f = await busFixture();
    await f.car('Van', 8, ['L1']);
    const run = (await f.svc.getRun(f.admin)).run;
    await f.bus.tryLock(run.id, 'Sarah', new Date().toISOString(), future(30_000));
    await f.svc.setPool(f.admin, { availableLeaderIds: ['L2'] });
    expect((await f.bus.getRun(run.id))!).toMatchObject({ lockBy: 'Sarah', availablePoolLeaderIds: ['L2'] });
  });

  it('Google failure: 502, nothing changes, lock released', async () => {
    const f = await busFixture({ routing: stubRouting({ solve: async () => { throw new RoutingError('Google route optimisation timed out'); } }) });
    await f.car('Van', 8, ['L1', 'L2']);
    await f.rider('s1');
    const before = await f.svc.getRun(f.admin);
    await expect(f.svc.generate(f.admin, { mode: 'all' })).rejects.toMatchObject({ statusCode: 502, code: 'ROUTING_FAILED' });
    const after = await f.svc.getRun(f.admin);
    expect(after.run.version).toBe(before.run.version);
    expect(after.riders.map((r) => r.runVehicleId)).toEqual(before.riders.map((r) => r.runVehicleId));
    expect(after.run).toMatchObject({ lockBy: null, undoUntil: null });
  });

  it('a rider removed while Google is solving is not re-created', async () => {
    const fake = new FakeRoutingProvider();
    let victim = '';
    // eslint-disable-next-line prefer-const
    let f: Awaited<ReturnType<typeof busFixture>>;
    f = await busFixture({ routing: stubRouting({ solve: async (p, s) => { if (victim) await f.bus.deleteRunRider(victim); return fake.solve(p, s); } }) });
    await f.car('Van', 8, ['L1', 'L2']);
    victim = (await f.rider('s1')).id; await f.rider('s2');
    await f.svc.generate(f.admin, { mode: 'all' });
    expect((await f.svc.getRun(f.admin)).riders.map((r) => r.name)).toEqual(['Sam Ode']);
  });

  it('needs a church pin and a running car; grade logins cannot generate', async () => {
    const noChurch = await busFixture({ churchPlaceId: '' });
    await expect(noChurch.svc.generate(noChurch.admin, { mode: 'all' })).rejects.toMatchObject({ statusCode: 400 });
    const f = await busFixture();
    await f.rider('s1');
    await expect(f.svc.generate(f.admin, { mode: 'all' })).rejects.toMatchObject({ statusCode: 400, message: 'Turn on at least one car in Car setup' });
    await f.car('Van', 8, ['L1', 'L2']);
    await expect(f.svc.generate(f.ctx('grade'), { mode: 'all' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.svc.generate(f.ctx('quad'), { mode: 'all' })).resolves.toBeTruthy();
  });

  it('a self-identified coordinator can generate from a grade login', async () => {
    const f = await busFixture();
    const s = await f.settings.getSettings();
    await f.settings.updateSettings({ ministryConfig: mergeMinistryConfig(s.ministryConfig, { busMinistry: { coordinatorLeaderIds: ['L1'] } }) });
    await f.car('Van', 8, ['L1', 'L2']); await f.rider('s1');
    await expect(f.svc.generate(f.ctx('grade', 'L1'), { mode: 'all' })).resolves.toMatchObject({ placed: 1 });
  });
});

describe('undo', () => {
  it('restores placements within 2 minutes, then there is nothing to undo', async () => {
    const f = await busFixture();
    await f.car('Van', 8, ['L1', 'L2']);
    await f.rider('s1'); await f.rider('s2');
    await f.svc.generate(f.admin, { mode: 'all' });
    await f.svc.undo(f.admin);
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.every((r) => r.runVehicleId === null)).toBe(true);
    expect(v.run.undoUntil).toBeNull();
    await expect(f.svc.undo(f.admin)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('an expired undo is refused; a car turned off since is not restored into', async () => {
    const f = await busFixture();
    const a = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1');
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: a });
    await f.svc.generate(f.admin, { mode: 'all' });
    const run = (await f.svc.getRun(f.admin)).run;
    const r = (await f.bus.getRun(run.id))!;
    await f.svc.updateRunVehicle(f.admin, a, { running: false });
    await f.svc.undo(f.admin);
    expect((await f.svc.getRun(f.admin)).riders[0]!.runVehicleId).toBeNull();
    await f.bus.setUndo(r.id, r.undoSnapshot, new Date(Date.now() - 1000).toISOString());
    await expect(f.svc.undo(f.admin)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('Move re-orders the car', () => {
  const reversed = stubRouting({ solve: async (p) => ({ skipped: [], routes: [{ vehicle: 0, stops: p.stops.map((_, i) => i).reverse(),
    legsSec: [], totalSec: 0, polyline: null, legPolylines: [] }] }) });
  it('uses a single-car solve; if Google fails the rider is still moved (appended)', async () => {
    const f = await busFixture({ routing: reversed });
    const a = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1'); const sam = await f.rider('s2');
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: a });
    const moved = await f.svc.moveRider(f.admin, sam.id, { runVehicleId: a });
    expect(moved.stopOrder).toBe(1);
    expect((await f.svc.getRun(f.admin)).riders.find((r) => r.id === jess.id)!.stopOrder).toBe(2);

    const g = await busFixture({ routing: stubRouting({ solve: async () => { throw new RoutingError('down'); } }) });
    const b = await g.car('Van', 8, ['L1', 'L2']);
    const j2 = await g.rider('s1'); const s2 = await g.rider('s2');
    await g.svc.moveRider(g.admin, j2.id, { runVehicleId: b });
    expect((await g.svc.moveRider(g.admin, s2.id, { runVehicleId: b })).stopOrder).toBe(2);
  });
  it('own car riders are ordered by a single-car solve too', async () => {
    const f = await busFixture({ routing: reversed });
    const jess = await f.rider('s1'); const sam = await f.rider('s2');
    await f.svc.saveOwnCar(f.ctx('grade', 'L3'), { car: { name: 'Car', seats: 5, plate: null, endsAt: 'last_drop', endsAddress: null, endsPlaceId: null },
      riderIds: [jess.id, sam.id] });
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.find((r) => r.id === sam.id)!.stopOrder).toBe(1);
  });
});

describe('autocomplete', () => {
  it('short input returns [] without calling Google; region code and session are passed through', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    expect(await f.svc.autocomplete(f.admin, 'ab', 'sess-12345678')).toEqual([]);
    expect(rec.calls.autocomplete).toHaveLength(0);
    const hits = await f.svc.autocomplete(f.admin, '24 Wynnum', 'sess-12345678');
    expect(hits[0]).toEqual({ placeId: 'fake:24-wynnum:1', text: '24 Wynnum 1, Testville' });
    expect(rec.calls.autocomplete[0]).toEqual({ input: '24 Wynnum', session: 'sess-12345678', region: 'au' });
  });
});
