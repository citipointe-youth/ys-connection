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
    // I3: tryLock + releaseLock each bump the version too, not just the write — so this is now
    // more than +1, just always higher than before the generate.
    expect(v.run.version).toBeGreaterThan(v0.run.version);
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

  // Prod 2026-10-06: riders moved to Unassigned by hand were silently skipped, so Generate "worked" but placed no one.
  // Owner 2026-10-06: moving someone to Unassigned unpins them, so the next Generate / Fit in places them again.
  it('a rider moved to Unassigned by hand is unpinned and re-placed by Fit in', async () => {
    const f = await busFixture();
    const a = await f.car('Van A', 8, ['L1', 'L2']);
    const jess = await f.rider('s1');
    expect(await f.svc.moveRider(f.admin, jess.id, { runVehicleId: null })).toMatchObject({ runVehicleId: null, pinned: false });
    expect(await f.svc.generate(f.admin, { mode: 'fit' })).toMatchObject({ placed: 1, unassigned: 0 });
    expect((await f.svc.getRun(f.admin)).riders[0]).toMatchObject({ runVehicleId: a, pinned: false });
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
    // saveRun was removed (dead code — this stale-lock setup was its only caller); poke the
    // in-memory store's run map directly instead.
    (f.bus as unknown as { runs: Map<string, { lockUntil: string | null }> }).runs.get(run.id)!.lockUntil = new Date(Date.now() - 1000).toISOString();
    await expect(f.svc.generate(f.admin, { mode: 'all' })).resolves.toMatchObject({ placed: 1 });
    expect((await f.bus.getRun(run.id))!.lockBy).toBeNull();
  });

  // I1 (controller ruling): these three writers feed the solve (car seats/running state,
  // leader pool/fixed-car prefs) — a mid-solve edit could write riders into a stale car, so
  // they now throw the same 409 lock error Move/generate already use.
  it('I1: updateRunVehicle, saveVehicle (tonight part) and setLeaderPrefs are blocked by an active lock', async () => {
    const f = await busFixture();
    const rvId = await f.car('Van', 8, ['L1']);
    const run = (await f.svc.getRun(f.admin)).run;
    const vehicleId = (await f.svc.getRun(f.admin)).vehicles.find((x) => x.id === rvId)!.vehicleId!;
    await f.bus.tryLock(run.id, 'Sarah', new Date().toISOString(), future(30_000));
    await expect(f.svc.updateRunVehicle(f.admin, rvId, { running: false })).rejects.toMatchObject({ statusCode: 409, message: 'Sarah is generating routes…' });
    await expect(f.svc.saveVehicle(f.admin, { id: vehicleId, name: 'Van', seats: 5, prefGrades: [], endsAt: 'church' }))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(f.svc.setLeaderPrefs(f.admin, 'L2', { inPool: true })).rejects.toMatchObject({ statusCode: 409 });
    const after = await f.svc.getRun(f.admin);
    expect(after.run.lockBy).toBe('Sarah'); // untouched by the rejected calls
    expect(after.vehicles.find((x) => x.id === rvId)).toMatchObject({ running: true, seats: 8 }); // tonight's car unchanged
  });

  // I1 (controller ruling): setPool now throws the same 409 lock error as Move/generate while
  // a solve is in flight, instead of the old "write survives, lock untouched" behaviour — the
  // pool feeds the solve's auto-fill, so changing it mid-solve could feed a since-stale pool.
  it('I1: ticking pool availability during a generate is blocked (409)', async () => {
    const f = await busFixture();
    await f.car('Van', 8, ['L1']);
    const run = (await f.svc.getRun(f.admin)).run;
    await f.bus.tryLock(run.id, 'Sarah', new Date().toISOString(), future(30_000));
    await expect(f.svc.setPool(f.admin, { availableLeaderIds: ['L2'] })).rejects.toMatchObject({ statusCode: 409, message: 'Sarah is generating routes…' });
    expect((await f.bus.getRun(run.id))!).toMatchObject({ lockBy: 'Sarah', availablePoolLeaderIds: [] });
  });

  // Task 2: roster writes feed the solve same as the car/pool writers above — a mid-solve
  // addRider/removeRider/saveOwnCar/etc. could write into a stale or now-gone car.
  it('addRider, removeRider and saveOwnCar are blocked by an active lock', async () => {
    const f = await busFixture();
    await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1');
    const run = (await f.svc.getRun(f.admin)).run;
    await f.bus.tryLock(run.id, 'Sarah', new Date().toISOString(), future(30_000));
    await expect(f.svc.addRider(f.admin, { studentId: 's2', newAddress: { address: 'Second St', placeId: 'fake:s2' } }))
      .rejects.toMatchObject({ statusCode: 409, message: 'Sarah is generating routes…' });
    await expect(f.svc.removeRider(f.admin, jess.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(f.svc.saveOwnCar(f.ctx('grade', 'L3'),
      { car: { name: "Amy's car", seats: 4, plate: null, endsAt: 'last_drop', endsAddress: null, endsPlaceId: null }, riderIds: [jess.id] }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await f.svc.getRun(f.admin)).riders).toHaveLength(1); // untouched by the rejected calls
  });

  it('Google failure: 502, nothing changes, lock released', async () => {
    const f = await busFixture({ routing: stubRouting({ solve: async () => { throw new RoutingError('Google route optimisation timed out'); } }) });
    await f.car('Van', 8, ['L1', 'L2']);
    await f.rider('s1');
    const before = await f.svc.getRun(f.admin);
    await expect(f.svc.generate(f.admin, { mode: 'all' })).rejects.toMatchObject({ statusCode: 502, code: 'ROUTING_FAILED' });
    const after = await f.svc.getRun(f.admin);
    // I3: tryLock + releaseLock each bump the version (the business data below is still
    // untouched — that's the "nothing changes" this test is really about).
    expect(after.run.version).toBe(before.run.version + 2);
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
    // Task 1: placed/unassigned must reflect who was actually written, not the solver's plan —
    // the solver placed both riders, but the victim was deleted before the write and must not
    // count as placed.
    const res = await f.svc.generate(f.admin, { mode: 'all' });
    expect(res).toMatchObject({ placed: 1, unassigned: 0 });
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

// Task 4: never exactly one girl among a fleet car's riders (siblings at the same address
// excepted). Leaders don't matter; a car with only one rider at all is out of scope (nothing
// to be "alone with"). Stub routing fully controls placement so the scenarios are deterministic.
describe('lone girl rule', () => {
  it('a lone girl moves to a car with another girl when the re-solve allows it', async () => {
    let call = 0;
    const f = await busFixture({ routing: stubRouting({ solve: async (p) => {
      call++;
      // stop order = rider add order: 0=jess, 1=sam, 2=mia
      if (call === 1) return { skipped: [], routes: [
        { vehicle: 0, stops: [0, 1], legsSec: [0, 0], totalSec: 0, polyline: null, legPolylines: [] }, // jess, sam -> car A
        { vehicle: 1, stops: [2], legsSec: [0], totalSec: 0, polyline: null, legPolylines: [] },        // mia -> car B
      ] };
      return { skipped: [], routes: [ // the lone-girl re-solve: jess moves to join mia
        { vehicle: 0, stops: [1], legsSec: [0], totalSec: 0, polyline: null, legPolylines: [] },        // sam -> car A
        { vehicle: 1, stops: [2, 0], legsSec: [0, 0], totalSec: 0, polyline: null, legPolylines: [] },  // mia, jess -> car B
      ] };
    } }) });
    const carA = await f.car('Van A', 8, ['L1', 'L2']);
    const carB = await f.car('Van B', 8, ['L3', 'L4']);
    const jess = await f.rider('s1'); const sam = await f.rider('s2'); const mia = await f.rider('s4');
    const res = await f.svc.generate(f.admin, { mode: 'all' });
    expect(call).toBe(2);
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.find((r) => r.id === jess.id)!.runVehicleId).toBe(carB);
    expect(v.riders.find((r) => r.id === mia.id)!.runVehicleId).toBe(carB);
    expect(v.riders.find((r) => r.id === sam.id)!.runVehicleId).toBe(carA);
    expect(res.loneGirl).toBe(0);
  });

  it('a lone girl with no alternative car ends Unassigned, loneGirl:1', async () => {
    let call = 0;
    const f = await busFixture({ routing: stubRouting({ solve: async () => {
      call++;
      if (call === 1) return { skipped: [], routes: [
        { vehicle: 0, stops: [0, 1], legsSec: [0, 0], totalSec: 0, polyline: null, legPolylines: [] }, // jess, sam -> the only car
      ] };
      return { skipped: [0], routes: [ // jess excluded from her only car -> skipped
        { vehicle: 0, stops: [1], legsSec: [0], totalSec: 0, polyline: null, legPolylines: [] },
      ] };
    } }) });
    const carA = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1'); const sam = await f.rider('s2');
    const res = await f.svc.generate(f.admin, { mode: 'all' });
    expect(call).toBe(2);
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.find((r) => r.id === jess.id)).toMatchObject({ runVehicleId: null, stopOrder: null, pinned: false });
    expect(v.riders.find((r) => r.id === sam.id)!.runVehicleId).toBe(carA);
    expect(res).toMatchObject({ placed: 1, unassigned: 1, loneGirl: 1 });
  });

  it('two riders at the same address (girl + brother) are allowed — no re-solve', async () => {
    let call = 0;
    const f = await busFixture({ routing: stubRouting({ solve: async () => {
      call++;
      return { skipped: [], routes: [
        { vehicle: 0, stops: [0, 1], legsSec: [0, 0], totalSec: 0, polyline: null, legPolylines: [] }, // jess, sam -> the only car
      ] };
    } }) });
    const carA = await f.car('Van', 8, ['L1', 'L2']);
    // give Sam the same placeId as Jess so the sibling exception applies
    const jess = await f.svc.addRider(f.admin, { studentId: 's1', newAddress: { label: 'Home', address: 'Shared St', placeId: 'fake:shared' } });
    const sam = await f.svc.addRider(f.admin, { studentId: 's2', newAddress: { label: 'Home', address: 'Shared St', placeId: 'fake:shared' } });
    const res = await f.svc.generate(f.admin, { mode: 'all' });
    expect(call).toBe(1); // no lone-girl re-solve needed
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.find((r) => r.id === jess.id)!.runVehicleId).toBe(carA);
    expect(v.riders.find((r) => r.id === sam.id)!.runVehicleId).toBe(carA);
    expect(res.loneGirl).toBe(0);
  });
});

describe('moveRider: unpin', () => {
  it('unpins a rider without changing their car or stop order', async () => {
    const f = await busFixture();
    const a = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1');
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: a });
    const before = (await f.svc.getRun(f.admin)).riders.find((r) => r.id === jess.id)!;
    expect(before.pinned).toBe(true);
    const res = await f.svc.moveRider(f.admin, jess.id, { unpin: true });
    expect(res).toMatchObject({ runVehicleId: a, stopOrder: before.stopOrder, pinned: false });
    expect((await f.svc.getRun(f.admin)).riders.find((r) => r.id === jess.id))
      .toMatchObject({ runVehicleId: a, stopOrder: before.stopOrder, pinned: false });
  });

  it('unpins a rider sitting in Unassigned; blocked by an active lock', async () => {
    const f = await busFixture();
    const jess = await f.rider('s1');
    await f.bus.saveRunRider({ ...(await f.bus.getRunRider(jess.id))!, pinned: true }); // legacy pinned-in-Unassigned row
    const res = await f.svc.moveRider(f.admin, jess.id, { unpin: true });
    expect(res).toMatchObject({ runVehicleId: null, pinned: false });
    const run = (await f.svc.getRun(f.admin)).run;
    await f.bus.tryLock(run.id, 'Sarah', new Date().toISOString(), future(30_000));
    await expect(f.svc.moveRider(f.admin, jess.id, { unpin: true })).rejects.toMatchObject({ statusCode: 409 });
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

  // I2 (controller ruling): Move, own-car save and rider removal clear the snapshot, so a
  // later Undo can only ever revert a generate nobody has touched since. The SPA's own
  // "!v.run.undoUntil" check (the Undo bar/toast) then stops offering Undo on its own.
  it('I2: Move after a generate clears the snapshot', async () => {
    const f = await busFixture();
    const a = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1'); await f.rider('s2');
    await f.svc.generate(f.admin, { mode: 'all' });
    expect((await f.svc.getRun(f.admin)).run.undoUntil).not.toBeNull();
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: a });
    expect((await f.svc.getRun(f.admin)).run.undoUntil).toBeNull();
    await expect(f.svc.undo(f.admin)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('I2: saving an own car after a generate clears the snapshot', async () => {
    const f = await busFixture();
    await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1');
    await f.svc.generate(f.admin, { mode: 'all' });
    await f.svc.saveOwnCar(f.ctx('grade', 'L3'),
      { car: { name: "Amy's car", seats: 4, plate: null, endsAt: 'last_drop', endsAddress: null, endsPlaceId: null }, riderIds: [jess.id] });
    expect((await f.svc.getRun(f.admin)).run.undoUntil).toBeNull();
    await expect(f.svc.undo(f.admin)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('I2: removing a rider after a generate clears the snapshot', async () => {
    const f = await busFixture();
    await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1'); await f.rider('s2');
    await f.svc.generate(f.admin, { mode: 'all' });
    await f.svc.removeRider(f.admin, jess.id);
    expect((await f.svc.getRun(f.admin)).run.undoUntil).toBeNull();
    await expect(f.svc.undo(f.admin)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('I2: Undo never pulls a rider out of an own car, even if a stale snapshot says otherwise', async () => {
    const f = await busFixture();
    const a = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1');
    const run = (await f.svc.getRun(f.admin)).run;
    await f.svc.saveOwnCar(f.ctx('grade', 'L3'),
      { car: { name: "Amy's car", seats: 4, plate: null, endsAt: 'last_drop', endsAddress: null, endsPlaceId: null }, riderIds: [jess.id] });
    const ownCarRvId = (await f.svc.getRun(f.admin)).riders.find((r) => r.id === jess.id)!.runVehicleId!;
    // Directly re-set a snapshot claiming Jess belongs back on the fleet van — isolates the
    // undo()-loop's own-car guard from the (already-tested) snapshot-clearing above.
    await f.bus.setUndo(run.id, [{ riderId: jess.id, runVehicleId: a, stopOrder: 1, pinned: false }], future(120_000));
    await f.svc.undo(f.admin);
    expect((await f.svc.getRun(f.admin)).riders.find((r) => r.id === jess.id)!.runVehicleId).toBe(ownCarRvId);
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

// Leader preferred grades: a car's effective prefGrades unions its vehicle's own with the
// prefGrades of whichever leaders end up in it. Both fleet vehicles start at the same church
// placeId, so FakeRoutingProvider's score() (cost*60 + fakeSeconds) is driven entirely by the
// prefWeightMin cost difference below — deterministic regardless of the fake distance.
describe('leader preferred grades feed the solver', () => {
  it('a Y10 rider lands in the car whose leader prefers Y10, not a car that excludes it', async () => {
    const f = await busFixture();
    const a = await f.car('Van A', 8, ['L1', 'L2'], { prefGrades: [8] }); // vehicle itself excludes Y10
    const b = await f.car('Van B', 8, ['L3', 'L4']); // no vehicle prefGrades at all
    await f.svc.setLeaderPrefs(f.admin, 'L3', { prefGrades: [10] }); // only L3's own prefs name Y10
    const riley = await f.rider('s3'); // Riley Kim, Y10
    await f.svc.generate(f.admin, { mode: 'all' });
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.find((r) => r.id === riley.id)!.runVehicleId).toBe(b);
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
