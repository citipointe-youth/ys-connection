import type { RoutingProvider, SolveProblem, SolveResult, SolvedRoute, PlaceSuggestion, RoutePoint, MapPath, MapMarker,
  MapImage } from './routing-provider';
import { encodePolyline, decodePolyline, type LatLng } from './polyline';

// Deterministic, straight-line, no network. Used in tests, PERSISTENCE=memory and whenever the
// Google env is missing — so the whole feature can be exercised locally without a key.
const KMH = 40;
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** A pseudo-location inside a ~33 km box around 0,0 — not anywhere real on purpose. */
export function fakePoint(placeId: string): LatLng {
  const h = hash(placeId);
  return { lat: ((h & 0xffff) / 0xffff - 0.5) * 0.3, lng: ((h >>> 16) / 0xffff - 0.5) * 0.3 };
}
function km(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
export function fakeSeconds(from: RoutePoint, to: RoutePoint): number {
  return Math.round((km(fakePoint(from.placeId), fakePoint(to.placeId)) / KMH) * 3600);
}

export class FakeRoutingProvider implements RoutingProvider {
  readonly name = 'fake' as const;

  async solve(p: SolveProblem, _signal?: AbortSignal): Promise<SolveResult> {
    const loads = p.vehicles.map(() => 0);
    const groups: number[][] = p.vehicles.map(() => []);
    const skipped: number[] = [];
    p.stops.forEach((s, i) => {
      const options = (s.allowedVehicles ?? p.vehicles.map((_, k) => k))
        .filter((k) => k < p.vehicles.length && loads[k]! < p.vehicles[k]!.capacity);
      if (!options.length) { skipped.push(i); return; }
      const score = (k: number) => (s.costs.find((c) => c.vehicle === k)?.cost ?? 0) * 60 + fakeSeconds(p.vehicles[k]!.start, s.point);
      const best = options.reduce((a, b) => (score(b) < score(a) ? b : a));
      loads[best]!++; groups[best]!.push(i);
    });
    const routes: SolvedRoute[] = [];
    groups.forEach((idxs, k) => {
      if (!idxs.length) return;
      const v = p.vehicles[k]!;
      const order: number[] = [];
      const left = [...idxs];
      let at = v.start;
      while (left.length) { // nearest neighbour from the start
        const j = left.reduce((a, b) => (fakeSeconds(at, p.stops[b]!.point) < fakeSeconds(at, p.stops[a]!.point) ? b : a));
        order.push(j); left.splice(left.indexOf(j), 1); at = p.stops[j]!.point;
      }
      const pts: RoutePoint[] = [v.start, ...order.map((j) => p.stops[j]!.point), ...(v.end ? [v.end] : [])];
      const legs = pts.slice(1).map((to, n) => [pts[n]!, to] as const);
      const legsSec = legs.map(([a, b]) => fakeSeconds(a, b));
      routes.push({
        vehicle: k, stops: order, legsSec, totalSec: legsSec.reduce((a, b) => a + b, 0),
        polyline: p.polylines ? encodePolyline(pts.map((x) => fakePoint(x.placeId))) : null,
        legPolylines: p.polylines ? legs.map(([a, b]) => encodePolyline([fakePoint(a.placeId), fakePoint(b.placeId)])) : [],
      });
    });
    return { routes, skipped };
  }

  async autocomplete(input: string, _sessionToken?: string, _regionCode?: string, _signal?: AbortSignal): Promise<PlaceSuggestion[]> {
    const q = input.trim();
    if (q.length < 3) return [];
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return [1, 2, 3].map((n) => ({ placeId: `fake:${slug}:${n}`, text: `${q} ${n}, Testville` }));
  }

  async matrix(pairs: { from: RoutePoint; to: RoutePoint }[], _signal?: AbortSignal): Promise<number[]> {
    return pairs.map((x) => fakeSeconds(x.from, x.to));
  }

  /** A plain SVG of the straight-line routes — enough to check the Route analysis screen locally. */
  async staticMap(paths: MapPath[], markers: MapMarker[], _signal?: AbortSignal): Promise<MapImage> {
    const pts: LatLng[] = [...paths.flatMap((p) => decodePolyline(p.polyline)), ...markers];
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    const minLat = pts.length ? Math.min(...lats) : 0, minLng = pts.length ? Math.min(...lngs) : 0;
    const span = pts.length ? Math.max(Math.max(...lats) - minLat, Math.max(...lngs) - minLng) || 1 : 1;
    const x = (p: LatLng) => (20 + ((p.lng - minLng) / span) * 600).toFixed(1);
    const y = (p: LatLng) => (620 - ((p.lat - minLat) / span) * 600).toFixed(1);
    const lines = paths.map((p) => `<polyline fill="none" stroke="${p.colour}" stroke-width="4" points="${decodePolyline(p.polyline).map((q) => `${x(q)},${y(q)}`).join(' ')}"/>`).join('');
    const dots = markers.map((m) => `<circle cx="${x(m)}" cy="${y(m)}" r="11" fill="${m.colour}"/>`
      + `<text x="${x(m)}" y="${(Number(y(m)) + 4).toFixed(1)}" font-size="12" font-family="sans-serif" text-anchor="middle" fill="#fff">${m.label}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#eef2f7"/>${lines}${dots}</svg>`;
    return { contentType: 'image/svg+xml', bytes: new TextEncoder().encode(svg) };
  }
}
