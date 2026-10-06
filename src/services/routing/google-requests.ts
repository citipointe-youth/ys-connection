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
      // Owner decision: without this the solver only minimised total driving minutes, so
      // "Try +N cars" / Generate never split riders to finish the night earlier — 1 minute of
      // makespan (the latest car's finish time) now costs the same as 1 minute of total driving.
      globalDurationCostPerHour: COST_PER_HOUR,
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
        routeDurationLimit: { quadraticSoftMaxDuration: sec(p.targetRouteMin * 60), costPerSquareHourAfterQuadraticSoftMax: QUAD_COST_PER_SQ_HOUR,
          maxDuration: sec(HORIZON_MS / 1000) }, // Google 400s a quadratic soft max with no hard max; the horizon never binds
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

export const MATRIX_MAX_PAIRS = 25; // safety chunk size — a car's own skip pairs rarely get near this
// I5: a car's skip-leg pairs chain (stop i's "to" is usually stop i+1's "from"), so building the
// request from only the DISTINCT origins/destinations `pairs` reference bills far fewer elements
// than one row/column per pair (which was reading only the diagonal of an N×N matrix).
export function routeMatrixBody(pairs: { from: RoutePoint; to: RoutePoint }[]) {
  const origins = [...new Set(pairs.map((x) => x.from.placeId))];
  const destinations = [...new Set(pairs.map((x) => x.to.placeId))];
  return { origins: origins.map((id) => ({ waypoint: wp({ placeId: id }) })), destinations: destinations.map((id) => ({ waypoint: wp({ placeId: id }) })),
    travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' };
}
/** Looks up each pair's duration by its origin/destination place ID — pairs can share a row or
 *  column after the dedup above, so position no longer lines up with a plain diagonal read. */
export function parseRouteMatrix(json: unknown, pairs: { from: RoutePoint; to: RoutePoint }[]): number[] {
  const origins = [...new Set(pairs.map((x) => x.from.placeId))];
  const destinations = [...new Set(pairs.map((x) => x.to.placeId))];
  const cell = new Map<string, number>();
  for (const e of (Array.isArray(json) ? json : []) as any[]) {
    const o = e.originIndex ?? 0, d = e.destinationIndex ?? 0;
    if (e.condition === 'ROUTE_EXISTS') cell.set(`${o}:${d}`, secOf(e.duration));
  }
  const out = pairs.map((p) => cell.get(`${origins.indexOf(p.from.placeId)}:${destinations.indexOf(p.to.placeId)}`));
  if (out.some((x) => x === undefined)) throw new RoutingError('Some trips could not be routed');
  return out as number[];
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
