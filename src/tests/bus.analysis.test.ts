import { describe, it, expect } from 'vitest';
import { busFixture, recordingRouting, stubRouting } from './helpers/bus-fixtures';
import { BUS_CAR_COLOURS } from '../services/bus-logic';

// One car, two riders: legs church→Jess 600s, Jess→Sam 300s, Sam→church 900s; every skip leg 700s.
const fixed = stubRouting({
  solve: async (p) => ({ skipped: [], routes: [{ vehicle: 0, stops: p.stops.map((_, i) => i),
    legsSec: p.stops.length === 2 ? [600, 300, 900] : p.stops.map(() => 60), totalSec: 1800, polyline: null, legPolylines: [] }] }),
  matrix: async (pairs) => pairs.map(() => 700),
});

describe('route analysis', () => {
  it('ranks riders by detour and flags ≥ detourMin or ≥ detourPct', async () => {
    const f = await busFixture({ routing: fixed });
    const van = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1'); const sam = await f.rider('s2');
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: van });
    await f.svc.moveRider(f.admin, sam.id, { runVehicleId: van });
    const a = await f.svc.analysis(f.ctx('director'));
    expect(a.cars).toHaveLength(1);
    expect(a.cars[0]).toMatchObject({ runVehicleId: van, name: 'Van', routeMin: 30 });
    expect(a.cars[0]!.riders.map((r) => [r.name, r.stop, r.detourMin, r.detourPct, r.flagged])).toEqual([
      ['Sam Ode', 2, 8, 28, true],      // 300+900−700 = 500s; 28% of 1800s ≥ 20%
      ['Jess Tran', 1, 3, 11, false],   // 600+300−700 = 200s
    ]);
    expect(a).toMatchObject({ detourMin: 10, detourPct: 20, unassigned: 0, longestMin: 30, totalMin: 30 });
  });

  // I5 (controller ruling): one small matrix per car, built from that car's own skip pairs —
  // not every car's legs mixed into shared 25-pair chunks — and cached alongside the solve.
  it('I5: one matrix call per car, not one combined call across all cars — and the result is cached per run version', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    const vanA = await f.car('Van A', 8, ['L1', 'L2']);
    const vanB = await f.car('Van B', 8, ['L3', 'L4']);
    const jess = await f.rider('s1'); const sam = await f.rider('s2');
    const riley = await f.rider('s3'); const mia = await f.rider('s4');
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: vanA });
    await f.svc.moveRider(f.admin, sam.id, { runVehicleId: vanA });
    await f.svc.moveRider(f.admin, riley.id, { runVehicleId: vanB });
    await f.svc.moveRider(f.admin, mia.id, { runVehicleId: vanB });
    const a = await f.svc.analysis(f.ctx('director'));
    expect(a.cars).toHaveLength(2);
    // One call per car (not 1 combined call across both cars' pairs), each scoped to just that
    // car's own small set of skip pairs — never the whole run mixed together.
    expect(rec.calls.matrix).toBe(2);
    for (const pairs of rec.calls.matrixCalls) expect(pairs.length).toBe(2);
    // Re-opening analysis at the same run version must not pay Google again.
    rec.calls.matrix = 0; rec.calls.matrixCalls = [];
    await f.svc.analysis(f.ctx('director'));
    expect(rec.calls.matrix).toBe(0);
  });

  // M6: a Bus-settings change (church/leave time/target route length) doesn't bump the run
  // version, so without them in the cache key a warm instance would keep serving a stale solve.
  it('M6: a target-route-length change busts the analysis cache even though the run version is unchanged', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    await f.car('Van', 8, ['L1', 'L2']);
    await f.rider('s1'); await f.rider('s2');
    await f.svc.generate(f.admin, { mode: 'all' });
    rec.calls.solve.length = 0;
    const v0 = (await f.svc.getRun(f.admin)).run.version;
    await f.svc.analysis(f.ctx('director'));
    expect(rec.calls.solve).toHaveLength(1);
    const s = await f.settings.getSettings();
    await f.settings.updateSettings({ ministryConfig: { ...s.ministryConfig,
      busMinistry: { ...s.ministryConfig.busMinistry, targetRouteMin: s.ministryConfig.busMinistry.targetRouteMin + 5 } } });
    expect((await f.svc.getRun(f.admin)).run.version).toBe(v0); // a settings change alone never touches the run
    await f.svc.analysis(f.ctx('director'));
    expect(rec.calls.solve).toHaveLength(2); // re-solved, not served stale from the old key
  });

  // M5: an empty map (no riders placed yet) always 400s against the real Static Maps API —
  // fail fast server-side instead of a guaranteed-failing Google call on every open.
  it('M5: no routes placed yet → 400 before any map call', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    await f.car('Van', 8, ['L1', 'L2']); // a running car but no riders placed into it
    await expect(f.svc.analysisMap(f.ctx('director'))).rejects.toMatchObject({ statusCode: 400 });
    expect(rec.calls.map).toHaveLength(0);
  });

  it('director/admin only; module off → 404', async () => {
    const f = await busFixture();
    await expect(f.svc.analysis(f.ctx('quad'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.svc.analysis(f.ctx('grade'))).rejects.toMatchObject({ statusCode: 403 });
    const off = await busFixture();
    const s = await off.settings.getSettings();
    await off.settings.updateSettings({ ministryConfig: { ...s.ministryConfig, modules: { ...s.ministryConfig.modules, busMinistry: false } } });
    await expect(off.svc.analysis(off.admin)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('Try +1 car re-solves with a virtual car and saves nothing', async () => {
    const f = await busFixture();
    await f.car('Small', 4, ['L1', 'L2']); // 2 youth seats
    for (const s of ['s1', 's2', 's3', 's4']) await f.rider(s);
    await f.svc.generate(f.admin, { mode: 'all' });
    const before = await f.svc.getRun(f.admin);
    const x = await f.svc.extraCars(f.admin, { count: 1, seats: 6 });
    expect(x).toMatchObject({ count: 1, seats: 6, before: { unassigned: 2 }, after: { unassigned: 0 } });
    const after = await f.svc.getRun(f.admin);
    expect(after.run.version).toBe(before.run.version);
    expect(after.riders.map((r) => r.runVehicleId)).toEqual(before.riders.map((r) => r.runVehicleId));
    await expect(f.svc.extraCars(f.admin, { count: 3, seats: 6 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('static map: numbered markers in car colours, no names sent, solve reused from analysis', async () => {
    const rec = recordingRouting();
    const f = await busFixture({ routing: rec.provider });
    await f.car('Van', 8, ['L1', 'L2']);
    // Task 4: two riders of the same gender — a mixed pair in the one car would trigger the
    // "never exactly one girl" rule (no alternative car here) and bump one to Unassigned,
    // which isn't what this test is about.
    await f.rider('s2'); await f.rider('s3');
    await f.svc.generate(f.admin, { mode: 'all' });
    rec.calls.solve.length = 0;
    await f.svc.analysis(f.admin);
    const img = await f.svc.analysisMap(f.admin);
    expect(rec.calls.solve).toHaveLength(1);
    expect(img.contentType).toBe('image/svg+xml');
    const { paths, markers } = rec.calls.map[0]!;
    expect(markers.map((m) => m.label)).toEqual(['1', '2']);
    expect(new Set([...paths, ...markers].map((x) => x.colour))).toEqual(new Set([BUS_CAR_COLOURS[0]]));
    // markers carry only colour, 1-char label and numbers (paths are encoded polylines, so not string-checked)
    expect(markers.every((m) => Object.keys(m).sort().join() === 'colour,label,lat,lng')).toBe(true);
  });

  it('Google failure → 502 ROUTING_FAILED', async () => {
    const f = await busFixture({ routing: stubRouting({ matrix: async () => { throw new Error('down'); } }) });
    const van = await f.car('Van', 8, ['L1', 'L2']);
    const jess = await f.rider('s1'); const sam = await f.rider('s2');
    await f.svc.moveRider(f.admin, jess.id, { runVehicleId: van });
    await f.svc.moveRider(f.admin, sam.id, { runVehicleId: van });
    await expect(f.svc.analysis(f.admin)).rejects.toMatchObject({ statusCode: 502, code: 'ROUTING_FAILED' });
  });
});
