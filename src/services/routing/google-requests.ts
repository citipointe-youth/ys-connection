import { RoutingError, type SolveProblem, type SolveResult, type SolvedRoute, type PlaceSuggestion, type RoutePoint,
  type MapPath, type MapMarker } from './routing-provider';

const COST_PER_HOUR = 60;                 // 1 cost unit = 1 minute driving, so penalty minutes plug straight in
export const SKIP_PENALTY = 100_000;      // leaving a rider unassigned beats no gender/grade penalty
const QUAD_COST_PER_SQ_HOUR = 240;        // quadratic soft cap past targetRouteMin
const DROP_SEC = 60;                      // time spent at each stop
const HORIZON_MS = 12 * 3_600_000;

const wp = (p: RoutePoint) => ({ placeId: p.placeId });
const sec = (n: number) => `${Math.round(n)}s`;
// proto3 JSON omits zero values: a missing duration is "0s", a missing index is 0.
const secOf = (d: unknown) => (typeof d === 'string' ? parseFloat(d) : 0);

export function optimizeToursBody(p: SolveProblem) {
  const start = new Date(p.startIso);
  return {
    model: {
      globalStartTime: start.toISOString(),
      globalEndTime: new Date(start.getTime() + HORIZON_MS).toISOString(),
      shipments: p.stops.map((s, i) => ({
        label: `r${i}`,
        deliveries: [{ arrivalWaypoint: wp(s.point), duration: sec(DROP_SEC) }],
        loadDemands: { seats: { amount: '1' } },
        ...(s.allowedVehicles ? { allowedVehicleIndices: s.allowedVehicles } : {}),
        ...(s.costs.length ? { costsPerVehicle: s.costs.map((c) => c.cost), costsPerVehicleIndices: s.costs.map((c) => c.vehicle) } : {}),
        ...(s.optional ? { penaltyCost: SKIP_PENALTY } : {}),
      })),
      vehicles: p.vehicles.map((v, i) => ({
        label: `v${i}`,
        startWaypoint: wp(v.start),
        ...(v.end ? { endWaypoint: wp(v.end) } : {}),
        loadLimits: { seats: { maxLoad: String(v.capacity) } },
        costPerHour: COST_PER_HOUR,
        routeDurationLimit: { quadraticSoftMaxDuration: sec(p.targetRouteMin * 60), costPerSquareHourAfterQuadraticSoftMax: QUAD_COST_PER_SQ_HOUR },
      })),
    },
    considerRoadTraffic: false,
    populatePolylines: p.polylines,
    populateTransitionPolylines: p.polylines,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseOptimizeTours(json: unknown, p: SolveProblem): SolveResult {
  const j = (json ?? {}) as any;
  const routes: SolvedRoute[] = (j.routes ?? []).map((r: any) => {
    const vehicle: number = r.vehicleIndex ?? 0;
    const visits: any[] = r.visits ?? [];
    const hasEnd = !!p.vehicles[vehicle]?.end;
    const trans: any[] = (r.transitions ?? []).slice(0, hasEnd ? visits.length + 1 : visits.length);
    const legsSec = trans.map((t) => secOf(t.travelDuration));
    return {
      vehicle, stops: visits.map((v) => v.shipmentIndex ?? 0), legsSec,
      totalSec: legsSec.reduce((a, b) => a + b, 0),
      polyline: r.routePolyline?.points ?? null,
      legPolylines: trans.map((t) => t.routePolyline?.points ?? ''),
    };
  }).filter((r: SolvedRoute) => r.stops.length > 0);
  return { routes, skipped: (j.skippedShipments ?? []).map((s: any) => s.index ?? 0) };
}

export function autocompleteBody(input: string, sessionToken: string, regionCode: string) {
  return { input, sessionToken, ...(regionCode ? { includedRegionCodes: [regionCode.toLowerCase()] } : {}) };
}
export function parseAutocomplete(json: unknown): PlaceSuggestion[] {
  const j = (json ?? {}) as any;
  return (j.suggestions ?? []).map((s: any) => s.placePrediction).filter(Boolean)
    .map((pp: any) => ({ placeId: String(pp.placeId ?? ''), text: String(pp.text?.text ?? '') }))
    .filter((x: PlaceSuggestion) => x.placeId && x.text).slice(0, 5);
}

export const MATRIX_MAX_PAIRS = 25; // 25 × 25 = 625 elements, the computeRouteMatrix cap
export function routeMatrixBody(pairs: { from: RoutePoint; to: RoutePoint }[]) {
  return { origins: pairs.map((x) => ({ waypoint: wp(x.from) })), destinations: pairs.map((x) => ({ waypoint: wp(x.to) })),
    travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' };
}
/** Reads only the diagonal (origin i → destination i). */
export function parseRouteMatrix(json: unknown, n: number): number[] {
  const out = new Array<number>(n).fill(NaN);
  for (const e of (Array.isArray(json) ? json : []) as any[]) {
    const o = e.originIndex ?? 0, d = e.destinationIndex ?? 0;
    if (o === d && o < n && e.condition === 'ROUTE_EXISTS') out[o] = secOf(e.duration);
  }
  if (out.some((x) => Number.isNaN(x))) throw new RoutingError('Some trips could not be routed');
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function markerLabel(i: number): string {
  return i < 9 ? String(i + 1) : i < 35 ? String.fromCharCode(65 + i - 9) : '';
}
export function staticMapUrl(paths: MapPath[], markers: MapMarker[], apiKey: string): string {
  const q = new URLSearchParams({ size: '640x640', scale: '2' });
  for (const p of paths) q.append('path', `color:0x${p.colour.slice(1)}ff|weight:4|enc:${p.polyline}`);
  for (const m of markers) {
    q.append('markers', ['size:mid', `color:0x${m.colour.slice(1)}`, ...(m.label ? [`label:${m.label}`] : []),
      `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`].join('|'));
  }
  q.append('key', apiKey);
  return `https://maps.googleapis.com/maps/api/staticmap?${q}`;
}
