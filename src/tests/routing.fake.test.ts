import { describe, it, expect } from 'vitest';
import { FakeRoutingProvider } from '../services/routing/fake-routing-provider';
import type { SolveProblem } from '../services/routing/routing-provider';

const sig = new AbortController().signal;
const church = { placeId: 'fake:church' };
const stop = (id: string, extra: Partial<SolveProblem['stops'][number]> = {}) =>
  ({ point: { placeId: id }, allowedVehicles: null, costs: [], optional: true, ...extra });

describe('FakeRoutingProvider', () => {
  const f = new FakeRoutingProvider();
  it('is deterministic and honours capacity (overflow is skipped)', async () => {
    const p: SolveProblem = { startIso: '2026-10-09T21:00:00.000Z', targetRouteMin: 45, polylines: false,
      vehicles: [{ start: church, end: church, capacity: 1 }, { start: church, end: null, capacity: 1 }],
      stops: [stop('fake:a'), stop('fake:b'), stop('fake:c')] };
    const a = await f.solve(p, sig), b = await f.solve(p, sig);
    expect(a).toEqual(b);
    expect(a.skipped).toEqual([2]);
    expect(a.routes.flatMap((r) => r.stops).sort()).toEqual([0, 1]);
    const withEnd = a.routes.find((r) => r.vehicle === 0)!;
    expect(withEnd.legsSec).toHaveLength(withEnd.stops.length + 1);
    const noEnd = a.routes.find((r) => r.vehicle === 1)!;
    expect(noEnd.legsSec).toHaveLength(noEnd.stops.length);
  });
  it('honours allowedVehicles and steers away from penalised vehicles', async () => {
    const p: SolveProblem = { startIso: '2026-10-09T21:00:00.000Z', targetRouteMin: 45, polylines: true,
      vehicles: [{ start: church, end: church, capacity: 5 }, { start: church, end: church, capacity: 5 }],
      stops: [stop('fake:a', { allowedVehicles: [1] }), stop('fake:b', { costs: [{ vehicle: 0, cost: 120 }] })] };
    const r = await f.solve(p, sig);
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0]!.vehicle).toBe(1);
    expect([...r.routes[0]!.stops].sort()).toEqual([0, 1]);
    expect(r.routes[0]!.legPolylines).toHaveLength(r.routes[0]!.legsSec.length);
    expect(r.routes[0]!.polyline).toBeTruthy();
  });
  it('autocomplete returns canned suggestions built from the query', async () => {
    expect(await f.autocomplete('ab', 's', '', sig)).toEqual([]);
    expect(await f.autocomplete(' 24 Wynnum ', 's', '', sig)).toEqual([
      { placeId: 'fake:24-wynnum:1', text: '24 Wynnum 1, Testville' },
      { placeId: 'fake:24-wynnum:2', text: '24 Wynnum 2, Testville' },
      { placeId: 'fake:24-wynnum:3', text: '24 Wynnum 3, Testville' },
    ]);
  });
  it('matrix is symmetric straight-line seconds; static map is an SVG', async () => {
    const [ab, ba] = await f.matrix([{ from: { placeId: 'fake:a' }, to: { placeId: 'fake:b' } }, { from: { placeId: 'fake:b' }, to: { placeId: 'fake:a' } }], sig);
    expect(ab).toBe(ba);
    expect(ab).toBeGreaterThan(0);
    const img = await f.staticMap([], [{ colour: '#2563eb', label: '1', lat: 0, lng: 0 }], sig);
    expect(img.contentType).toBe('image/svg+xml');
    expect(new TextDecoder().decode(img.bytes)).toContain('<svg');
  });
});
