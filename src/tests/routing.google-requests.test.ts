import { describe, it, expect } from 'vitest';
import type { SolveProblem } from '../services/routing/routing-provider';
import { RoutingError } from '../services/routing/routing-provider';
import { optimizeToursBody, parseOptimizeTours, autocompleteBody, parseAutocomplete, routeMatrixBody, parseRouteMatrix,
  staticMapUrl, markerLabel, SKIP_PENALTY } from '../services/routing/google-requests';
import { encodePolyline, decodePolyline, thinPolyline } from '../services/routing/polyline';

const problem: SolveProblem = {
  startIso: '2026-10-09T21:00:00.000Z', targetRouteMin: 45, polylines: true,
  vehicles: [
    { start: { placeId: 'P_church' }, end: { placeId: 'P_church' }, capacity: 8 },
    { start: { placeId: 'P_church' }, end: null, capacity: 3 },
  ],
  stops: [
    { point: { placeId: 'P_a' }, allowedVehicles: null, costs: [{ vehicle: 1, cost: 120 }], optional: true },
    { point: { placeId: 'P_b' }, allowedVehicles: [0], costs: [], optional: false },
  ],
};

// Every key Google is ever sent. Anything else (name, phone, grade, gender…) fails the test.
const ALLOWED_KEYS = new Set(['model', 'globalStartTime', 'globalEndTime', 'globalDurationCostPerHour', 'shipments', 'label',
  'deliveries', 'arrivalWaypoint',
  'placeId', 'duration', 'loadDemands', 'seats', 'amount', 'allowedVehicleIndices', 'costsPerVehicle', 'costsPerVehicleIndices',
  'penaltyCost', 'vehicles', 'startWaypoint', 'endWaypoint', 'loadLimits', 'maxLoad', 'costPerHour', 'routeDurationLimit',
  'quadraticSoftMaxDuration', 'maxDuration', 'costPerSquareHourAfterQuadraticSoftMax', 'considerRoadTraffic', 'populatePolylines',
  'populateTransitionPolylines', 'input', 'sessionToken', 'includedRegionCodes', 'origins', 'destinations', 'waypoint',
  'travelMode', 'routingPreference']);
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
}

describe('optimizeToursBody', () => {
  const body = optimizeToursBody(problem);
  it('maps stops to shipments with pins, penalties and optional skips', () => {
    expect(body.model.shipments[0]).toMatchObject({ label: 'r0', penaltyCost: SKIP_PENALTY, costsPerVehicle: [120], costsPerVehicleIndices: [1] });
    expect(body.model.shipments[0]).not.toHaveProperty('allowedVehicleIndices');
    expect(body.model.shipments[1]).toMatchObject({ label: 'r1', allowedVehicleIndices: [0] });
    expect(body.model.shipments[1]).not.toHaveProperty('penaltyCost');
    expect(body.model.shipments[0]!.deliveries[0]!.arrivalWaypoint).toEqual({ placeId: 'P_a' });
  });
  it('maps vehicles with capacity, minute-based cost and a quadratic soft cap', () => {
    expect(body.model.vehicles[0]).toMatchObject({ label: 'v0', endWaypoint: { placeId: 'P_church' },
      loadLimits: { seats: { maxLoad: '8' } }, costPerHour: 60,
      routeDurationLimit: { quadraticSoftMaxDuration: '2700s', maxDuration: '43200s' } }); // prod 400: Google requires maxDuration alongside a quadratic soft max
    expect(body.model.vehicles[1]).not.toHaveProperty('endWaypoint');
    expect(body.model.globalEndTime).toBe('2026-10-10T09:00:00.000Z');
    expect(body.populateTransitionPolylines).toBe(true);
  });
  // Owner decision: the solver only minimised total driving minutes, so Generate/"Try +N cars"
  // never split riders to finish the night earlier. globalDurationCostPerHour makes 1 minute of
  // makespan (the LATEST car's finish time) cost the same as 1 minute of total driving.
  it('sets globalDurationCostPerHour so the solver also minimises makespan, not just total driving', () => {
    expect(body.model.globalDurationCostPerHour).toBe(60);
  });
  it('only ever uses allow-listed keys', () => {
    const bad = keysOf(body).filter((k) => !ALLOWED_KEYS.has(k));
    expect(bad).toEqual([]);
  });
});

describe('parseOptimizeTours tolerates omitted zero fields (proto3 JSON)', () => {
  it('first vehicle, first shipment and 0s durations still parse; end leg dropped when the car ends at the last drop', () => {
    const json = { routes: [
      { visits: [{ shipmentIndex: 1 }, {}], transitions: [{ travelDuration: '600s', routePolyline: { points: 'aa' } }, { travelDuration: '300s' }, {}],
        routePolyline: { points: 'whole' } },
      { vehicleIndex: 1, visits: [{}], transitions: [{ travelDuration: '120s' }, {}] },
    ], skippedShipments: [{}] };
    const r = parseOptimizeTours(json, problem);
    expect(r.routes[0]).toEqual({ vehicle: 0, stops: [1, 0], legsSec: [600, 300, 0], totalSec: 900, polyline: 'whole', legPolylines: ['aa', '', ''] });
    expect(r.routes[1]).toMatchObject({ vehicle: 1, stops: [0], legsSec: [120], totalSec: 120 });
    expect(r.skipped).toEqual([0]);
  });
  it('drops vehicles with no visits', () => {
    expect(parseOptimizeTours({ routes: [{ vehicleIndex: 1 }] }, problem).routes).toEqual([]);
  });
});

describe('autocomplete', () => {
  it('sends only the text, session token and (when set) region', () => {
    expect(autocompleteBody('24 Wynnum', 'sess-1', '')).toEqual({ input: '24 Wynnum', sessionToken: 'sess-1' });
    expect(autocompleteBody('24 Wynnum', 'sess-1', 'AU')).toEqual({ input: '24 Wynnum', sessionToken: 'sess-1', includedRegionCodes: ['au'] });
  });
  it('keeps place predictions only', () => {
    const json = { suggestions: [
      { placePrediction: { placeId: 'P1', text: { text: '24 Wynnum Rd, Carina QLD, Australia' } } },
      { queryPrediction: { text: { text: 'pizza' } } },
    ] };
    expect(parseAutocomplete(json)).toEqual([{ placeId: 'P1', text: '24 Wynnum Rd, Carina QLD, Australia' }]);
  });
});

describe('route matrix', () => {
  it('builds origins/destinations and looks each pair up by place ID', () => {
    const pairs = [{ from: { placeId: 'A' }, to: { placeId: 'B' } }, { from: { placeId: 'C' }, to: { placeId: 'D' } }];
    expect(routeMatrixBody(pairs)).toEqual({
      origins: [{ waypoint: { placeId: 'A' } }, { waypoint: { placeId: 'C' } }],
      destinations: [{ waypoint: { placeId: 'B' } }, { waypoint: { placeId: 'D' } }],
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' });
    const json = [
      { duration: '100s', condition: 'ROUTE_EXISTS' },                                  // origin 0 → dest 0 (zeros omitted)
      { originIndex: 1, destinationIndex: 1, duration: '50s', condition: 'ROUTE_EXISTS' },
      { originIndex: 0, destinationIndex: 1, duration: '999s', condition: 'ROUTE_EXISTS' },
    ];
    expect(parseRouteMatrix(json, pairs)).toEqual([100, 50]);
  });
  it('throws a RoutingError when a pair has no route', () => {
    const pairs = [{ from: { placeId: 'A' }, to: { placeId: 'B' } }, { from: { placeId: 'C' }, to: { placeId: 'D' } }];
    const json = [{ duration: '1s', condition: 'ROUTE_EXISTS' }]; // only A→B present; C→D is missing
    expect(() => parseRouteMatrix(json, pairs)).toThrow(RoutingError);
  });
  // I5: a car's skip-leg pairs chain (one stop's "to" is usually the next stop's "from"), and
  // several cars can also share the same church origin/end — this must bill one row per
  // DISTINCT place, not one row per pair, or a chunk still bills ~N² elements for N values.
  it('I5: shares one origin row across pairs with the same origin, instead of one row per pair', () => {
    const pairs = [{ from: { placeId: 'CHURCH' }, to: { placeId: 'P1' } }, { from: { placeId: 'CHURCH' }, to: { placeId: 'P2' } }];
    const body = routeMatrixBody(pairs);
    expect(body.origins).toEqual([{ waypoint: { placeId: 'CHURCH' } }]); // 1 row, not 2 — this is the fix
    expect(body.destinations).toEqual([{ waypoint: { placeId: 'P1' } }, { waypoint: { placeId: 'P2' } }]);
    const json = [
      { originIndex: 0, destinationIndex: 0, duration: '300s', condition: 'ROUTE_EXISTS' },
      { originIndex: 0, destinationIndex: 1, duration: '400s', condition: 'ROUTE_EXISTS' },
    ];
    expect(parseRouteMatrix(json, pairs)).toEqual([300, 400]);
  });
});

describe('static map + polylines', () => {
  it('Google reference polyline round-trips', () => {
    const pts = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
  });
  it('thinPolyline caps the point count and keeps both ends', () => {
    // `|| 0` avoids a signed -0 at i===0: Google's polyline encoding (via << / ~) can't
    // round-trip -0 vs 0 — that's an inherent property of the bitwise algorithm, not a bug.
    const pts = Array.from({ length: 1000 }, (_, i) => ({ lat: i / 1000, lng: -(i / 1000) || 0 }));
    const thin = decodePolyline(thinPolyline(encodePolyline(pts), 120));
    expect(thin.length).toBeLessThanOrEqual(120);
    expect(thin[0]).toEqual(pts[0]);
    expect(thin[thin.length - 1]).toEqual(pts[999]);
  });
  it('builds path + numbered marker params', () => {
    const url = new URL(staticMapUrl([{ colour: '#2563eb', polyline: 'abc' }], [{ colour: '#2563eb', label: '1', lat: -1.5, lng: 2.25 }], 'KEY'));
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/staticmap');
    expect(url.searchParams.getAll('path')).toEqual(['color:0x2563ebff|weight:4|enc:abc']);
    expect(url.searchParams.getAll('markers')).toEqual(['size:mid|color:0x2563eb|label:1|-1.50000,2.25000']);
    expect(url.searchParams.get('key')).toBe('KEY');
  });
  it('labels markers 1-9 then A-Z, then none', () => {
    expect([0, 8, 9, 34, 35].map(markerLabel)).toEqual(['1', '9', 'A', 'Z', '']);
  });
});
