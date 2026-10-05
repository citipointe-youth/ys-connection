# Bus Ministry: Release 2 (Google) + Release 3 (Route analysis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-backed routing to the R1 Bus Ministry core: address autocomplete with place IDs, Generate / Fit in / Re-generate all (with pool auto-fill, gender and grade penalties, pins, a 30 s lock and a 2-minute Undo), single-car re-ordering on Move and own cars, Maps links with place IDs (R2). Then add Route analysis: per-rider detour, "Try +1 / +2 cars" and a server-proxied static route map (R3).

**Architecture:** One `RoutingProvider` interface with two implementations: `GoogleRoutingProvider` (plain `fetch`, service-account JWT signed with `node:crypto`) and `FakeRoutingProvider` (deterministic straight-line, no network). Google request bodies are built and parsed by pure functions, so the no-PII rule and the response quirks are unit-tested without network. The rules that turn tonight's run into a solve problem live in pure `bus-plan.ts`. `bus.service.ts` adds generate/undo/autocomplete/analysis on top of R1's gate, `ensureRun` and `touch`. No migration: every column R2/R3 needs already exists in `0011`.

**Tech Stack:** TypeScript (strict), Express route table, Zod, postgres.js, vitest, vanilla SPA. Google Route Optimization API (`optimizeTours`), Places API (New) Autocomplete, Routes API (`computeRouteMatrix`), Maps Static API.

**Spec:** `docs/superpowers/specs/2026-10-05-bus-ministry-design.md`. This plan implements §2, §6 (Routes, My car, Route analysis), §7 (Generation, Maps link, Route analysis), §8, §9 and §10. R1 plan (conventions): `docs/superpowers/plans/2026-10-05-bus-ministry-r1-core.md`. Mockup: `_design/bus-ministry-mockup.html` (grep `data-section="routes"` / `"analysis"`).

**Path note:** ministry config lives at `src/core/ministry-config.ts` (not `src/config/`).

## Global Constraints

- **Delivery:** R2 and R3 run back-to-back on branch `bus-ministry` and merge to `master` once, after the owner has tested the whole feature locally. Never push. One commit per task, `git add` with explicit paths, ending with the executing session's `Co-Authored-By` / `Claude-Session` trailer lines.
- **Ponytail:** the simplest code that works, reusing R1 helpers (`gate`, `ensureRun`/`writableRun`, `touch`, `whoLabel`, `parseIn`, `riderView`, `vehicleViews`, `_busGet`/`_busSend`, `modal`, `toast`, `extractFn`/`loadFns`).
- **No new npm dependencies.** Google is called only from the server and only with plain `fetch`. The service-account JWT is RS256, signed with `node:crypto`.
- **No names, phones or grades in any Google request body.** Google receives place IDs, capacities, penalty numbers and autocomplete text, nothing else. Labels are `r<n>` / `v<n>`.
- **Env (server only):** `GOOGLE_MAPS_API_KEY` (Places, Routes matrix, Static Maps), `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (accept `\n`-escaped keys), `GOOGLE_PROJECT_ID` (Route Optimization, via OAuth). If any of them is missing, or when `PERSISTENCE=memory`, use `FakeRoutingProvider`. The one exception is `BUS_ROUTING=google`, which lets the owner test a real key in memory mode (see ruling R1).
- **Config:** add `busMinistry.regionCode` (default `''`), used for autocomplete `includedRegionCodes`. Nothing YS-Brisbane-specific may appear in code, config defaults or fake data.
- **HTTP contract (R1):** every `/bus` call carries `?now=YYYY-MM-DDTHH:mm` and an optional `&as=<leaderId>` query param, not a header. Errors are `AppError` subclasses with `statusCode`. When the module is off, the route returns 404 via `ModuleDisabledError`. RBAC: generate, undo and move need `bus:coordinate`; analysis, extra-cars and map need `bus:analysis`; autocomplete needs `bus:use`.
- **Google failure or >15 s:** respond `502 ROUTING_FAILED`, change nothing and release the lock. The SPA shows the message as a toast. Each user action gets one shared 15 s deadline (`routingDeadline()`), so token + solve + matrix together stay under the 20 s route timeout in `express-adapter.ts`.
- **Writes:** every write bumps the run version via `touch()`. Analysis, extra-cars and map write nothing and do not bump. jsonb is written via `this.j(...)` (`sql.json`), never `JSON.stringify(x)::jsonb`.
- **No migration (0013 not needed).** `bus_runs.lock_by/lock_until/undo_snapshot/undo_until`, `bus_run_riders.stop_order/pinned/snap_place_id` and `bus_run_vehicles.ends_place_id` all exist in `0011`. No coordinates and no durations are persisted. Place IDs are persisted (already encrypted).
- **No new top-level API path:** `/bus` is already in `router.ts`, `vercel.json` and `sw.js` `API_RE`.
- **SPA:** icons come only from the `IC` registry (already holds `bus, phone, pin, map, route, pinned, kebab`). No emoji or unicode symbols (`·` and `…` are the existing R1 typography and are fine). CSS must work on phone portrait, in landscape (`@media(max-height:500px)`) and at `≥768px`. Any inline-JS single-quoted string that contains an apostrophe must use double quotes. Bump the `CACHE` constant in `public/sw.js` by one in each SPA task.
- **Verification after every task:** `npm run typecheck`, `npx vitest run`, `node scripts/check-spa-syntax.js` — all green.

## Review Focus

1. **A rider removed, moved or put in an own car while Google is solving.** `saveRunRider` is an upsert, so writing back the solve would re-create a deleted rider or undo a move. Expected: generate re-reads the riders and only writes ones that still exist and are unchanged. Pinned by Task 3, "a rider removed while Google is solving is not re-created".
2. **Pool ticked during a generate.** R1's `setPool` used `saveRun` (a whole-row write), which would wipe `lock_by`/`lock_until` mid-generate. Expected: the lock survives. Pinned by Task 3, "ticking pool availability during a generate keeps the lock".
3. **Riders with no place ID.** These are riders added in R1, or riders whose address was typed without picking a suggestion. Expected: they are never sent to Google, keep their seat, are counted in `noAddressPin` and show "No map pin". Pinned by Task 3, "a rider with no map pin…", plus the SPA chip in Task 4.
4. **proto3 JSON drops zero values.** `vehicleIndex: 0`, `shipmentIndex: 0`, skipped `index: 0` and `"0s"` durations are omitted from the response. Expected: the first car and first rider still parse. Pinned by Task 1, "parseOptimizeTours tolerates omitted zero fields".
5. **The API key never leaks.** It sits in the static-map URL and in headers. Expected: errors, logs and HTTP responses never echo it. Pinned by Task 2, "a failed map call never echoes the key".

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/services/routing/routing-provider.ts` | provider interface, solve/map types, `RoutingError`, `routingDeadline()` | 1 |
| `src/services/routing/polyline.ts` | encode/decode/thin Google polylines | 1 |
| `src/services/routing/google-requests.ts` | pure Google request builders + response parsers, `markerLabel` | 1 |
| `src/services/routing/fake-routing-provider.ts` | deterministic straight-line provider (SVG map) | 1 |
| `src/services/routing/google-routing-provider.ts` | JWT, cached OAuth token, `fetch` transport, `routingFromEnv()` | 2 |
| `src/services/bus-plan.ts` | pure: pool auto-fill, penalties, fleet/single problems, placements; detours (T5) | 3, 5 |
| `src/core/entities/bus.ts` | `BusGenerateResult`, `MyCarView.churchPlaceId`; analysis view types (T5) | 3, 5 |
| `src/core/ministry-config.ts` | `busMinistry.regionCode` | 3 |
| `src/repositories/interfaces/entity-repositories.ts`, `in-memory/in-memory.bus.ts`, `supabase/supabase.bus.ts` | `tryLock`, `releaseLock`, `setUndo`, `setPoolIds` | 3 |
| `src/services/bus.service.ts` | generate/undo/autocomplete/reorder (T3); analysis/extra-cars/map (T5) | 3, 5 |
| `src/services/bus-logic.ts` | `BUS_CAR_COLOURS` (server copy of the SPA palette) | 5 |
| `src/api/controllers/bus.controller.ts`, `src/api/http/router.ts` | new `/bus` routes | 3, 5 |
| `src/api/http/types.ts`, `src/api/http/express-adapter.ts` | `RawResponse` (non-JSON results) | 5 |
| `src/container.ts` | `routingFromEnv()` wiring | 3 |
| `public/index.html` (BUS MODULE block + CSS + `MINISTRY_CONFIG_DEFAULTS_CLIENT`), `public/sw.js` | SPA | 4, 6 |
| `CLAUDE.md`, `debug.md` | docs | 7 |
| tests | `routing.google-requests.test.ts`, `routing.fake.test.ts`, `routing.google-transport.test.ts`, `bus-plan.test.ts`, `bus.generate.test.ts`, `bus.analysis.test.ts`, `http.raw-response.test.ts`, `helpers/bus-fixtures.ts`; appended: `bus.repo.test.ts`, `bus.routes.test.ts`, `spa-bus.test.ts` | 1–6 |

---

### Task 1: Routing contract, Fake provider, Google request builders (pure, no network)

**Files:**
- Create: `src/services/routing/routing-provider.ts`, `src/services/routing/polyline.ts`, `src/services/routing/google-requests.ts`, `src/services/routing/fake-routing-provider.ts`
- Test: `src/tests/routing.google-requests.test.ts`, `src/tests/routing.fake.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact names later tasks use):
  - `routing-provider.ts`: `RoutePoint`, `SolveVehicle`, `SolveStop`, `SolveProblem`, `SolvedRoute`, `SolveResult`, `PlaceSuggestion`, `MapPath`, `MapMarker`, `MapImage`, `RoutingProvider`, `class RoutingError`, `GOOGLE_TIMEOUT_MS = 15_000`, `routingDeadline(ms?): AbortSignal`.
  - `polyline.ts`: `LatLng`, `encodePolyline(points: LatLng[]): string`, `decodePolyline(s: string): LatLng[]`, `thinPolyline(s: string, maxPoints: number): string`.
  - `google-requests.ts`: `optimizeToursBody(p: SolveProblem)`, `parseOptimizeTours(json: unknown, p: SolveProblem): SolveResult`, `autocompleteBody(input, sessionToken, regionCode)`, `parseAutocomplete(json: unknown): PlaceSuggestion[]`, `MATRIX_MAX_PAIRS = 25`, `routeMatrixBody(pairs)`, `parseRouteMatrix(json: unknown, n: number): number[]`, `staticMapUrl(paths, markers, apiKey): string`, `markerLabel(i: number): string`, `SKIP_PENALTY`.
  - `fake-routing-provider.ts`: `class FakeRoutingProvider implements RoutingProvider`, `fakePoint(placeId): LatLng`, `fakeSeconds(from, to): number`.

- [ ] **Step 1: Write the failing tests** — `src/tests/routing.google-requests.test.ts`

```ts
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
const ALLOWED_KEYS = new Set(['model', 'globalStartTime', 'globalEndTime', 'shipments', 'label', 'deliveries', 'arrivalWaypoint',
  'placeId', 'duration', 'loadDemands', 'seats', 'amount', 'allowedVehicleIndices', 'costsPerVehicle', 'costsPerVehicleIndices',
  'penaltyCost', 'vehicles', 'startWaypoint', 'endWaypoint', 'loadLimits', 'maxLoad', 'costPerHour', 'routeDurationLimit',
  'quadraticSoftMaxDuration', 'costPerSquareHourAfterQuadraticSoftMax', 'considerRoadTraffic', 'populatePolylines',
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
      routeDurationLimit: { quadraticSoftMaxDuration: '2700s' } });
    expect(body.model.vehicles[1]).not.toHaveProperty('endWaypoint');
    expect(body.model.globalEndTime).toBe('2026-10-10T09:00:00.000Z');
    expect(body.populateTransitionPolylines).toBe(true);
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
  it('builds pairwise origins/destinations and reads the diagonal', () => {
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
    expect(parseRouteMatrix(json, 2)).toEqual([100, 50]);
  });
  it('throws a RoutingError when a pair has no route', () => {
    expect(() => parseRouteMatrix([{ duration: '1s', condition: 'ROUTE_EXISTS' }], 2)).toThrow(RoutingError);
  });
});

describe('static map + polylines', () => {
  it('Google reference polyline round-trips', () => {
    const pts = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
  });
  it('thinPolyline caps the point count and keeps both ends', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ lat: i / 1000, lng: -i / 1000 }));
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
```

`src/tests/routing.fake.test.ts`

```ts
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
```

- [ ] **Step 2: Run them to check they fail**

Run: `npx vitest run src/tests/routing.google-requests.test.ts src/tests/routing.fake.test.ts`
Expected: FAIL, "Cannot find module '../services/routing/…'".

- [ ] **Step 3: Write `src/services/routing/routing-provider.ts`**

```ts
// Everything Google ever receives flows through these types: place IDs, capacities and
// penalty numbers. Never a name, phone or grade (spec §9).
export interface RoutePoint { placeId: string }
export interface SolveVehicle {
  start: RoutePoint;
  end: RoutePoint | null;   // null = the route ends at the last drop
  capacity: number;         // youth seats
}
export interface SolveStop {
  point: RoutePoint;
  allowedVehicles: number[] | null;              // null = any vehicle
  costs: { vehicle: number; cost: number }[];    // penalty minutes for riding in that vehicle
  optional: boolean;                             // true = may be left unassigned; false = must be placed
}
export interface SolveProblem {
  startIso: string;          // nominal leave time; traffic is not considered so the zone does not matter
  targetRouteMin: number;    // quadratic soft cap per vehicle
  vehicles: SolveVehicle[];
  stops: SolveStop[];
  polylines: boolean;        // ask for route + per-leg polylines (analysis map)
}
export interface SolvedRoute {
  vehicle: number;
  stops: number[];           // indexes into SolveProblem.stops, in drive order
  legsSec: number[];         // start→stop1, stop1→stop2, …, stopN→end (the last entry only when the vehicle has an end)
  totalSec: number;          // sum of legsSec
  polyline: string | null;   // encoded polyline of the whole route
  legPolylines: string[];    // one encoded polyline per entry of legsSec ([] when polylines=false)
}
export interface SolveResult { routes: SolvedRoute[]; skipped: number[] }
export interface PlaceSuggestion { placeId: string; text: string }
export interface MapPath { colour: string; polyline: string }                 // colour = '#rrggbb'
export interface MapMarker { colour: string; label: string; lat: number; lng: number }
export interface MapImage { contentType: string; bytes: Uint8Array }

export interface RoutingProvider {
  readonly name: 'google' | 'fake';
  solve(p: SolveProblem, signal: AbortSignal): Promise<SolveResult>;
  autocomplete(input: string, sessionToken: string, regionCode: string, signal: AbortSignal): Promise<PlaceSuggestion[]>;
  /** Drive seconds for each from→to pair, same order as `pairs`. */
  matrix(pairs: { from: RoutePoint; to: RoutePoint }[], signal: AbortSignal): Promise<number[]>;
  staticMap(paths: MapPath[], markers: MapMarker[], signal: AbortSignal): Promise<MapImage>;
}

/** Thrown by providers. The message never contains the API key or a URL. */
export class RoutingError extends Error {
  constructor(message: string) { super(message); this.name = 'RoutingError'; }
}

export const GOOGLE_TIMEOUT_MS = 15_000;
/** One deadline per user action, shared by every Google call that action makes (token + solve + matrix). */
export function routingDeadline(ms = GOOGLE_TIMEOUT_MS): AbortSignal { return AbortSignal.timeout(ms); }
```

- [ ] **Step 4: Write `src/services/routing/polyline.ts`**

```ts
export interface LatLng { lat: number; lng: number }

// Google's encoded polyline algorithm (precision 1e5).
export function encodePolyline(points: LatLng[]): string {
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = '';
    while (s >= 0x20) { r += String.fromCharCode((0x20 | (s & 0x1f)) + 63); s >>= 5; }
    return r + String.fromCharCode(s + 63);
  };
  let out = '', pLat = 0, pLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat; pLng = lng;
  }
  return out;
}

export function decodePolyline(s: string): LatLng[] {
  const pts: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) { lat += next(); lng += next(); pts.push({ lat: lat / 1e5, lng: lng / 1e5 }); }
  return pts;
}

/** Keeps at most maxPoints (first and last always kept) so a static-map URL stays short. */
export function thinPolyline(s: string, maxPoints: number): string {
  const pts = decodePolyline(s);
  if (pts.length <= maxPoints) return s;
  const step = Math.ceil(pts.length / (maxPoints - 1));
  const kept = pts.filter((_, i) => i % step === 0);
  kept.push(pts[pts.length - 1]!);
  return encodePolyline(kept);
}
```

- [ ] **Step 5: Write `src/services/routing/google-requests.ts`**

```ts
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
```

- [ ] **Step 6: Write `src/services/routing/fake-routing-provider.ts`**

```ts
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
```

- [ ] **Step 7: Run the tests to check they pass**

Run: `npx vitest run src/tests/routing.google-requests.test.ts src/tests/routing.fake.test.ts`
Expected: PASS.

- [ ] **Step 8: Full verification**

Run: `npm run typecheck && npx vitest run && node scripts/check-spa-syntax.js`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/services/routing/routing-provider.ts src/services/routing/polyline.ts src/services/routing/google-requests.ts src/services/routing/fake-routing-provider.ts src/tests/routing.google-requests.test.ts src/tests/routing.fake.test.ts
git commit -m "feat(bus): routing contract, fake provider, pure Google request builders (R2)"
```

---

### Task 2: GoogleRoutingProvider transport + env factory

**Files:**
- Create: `src/services/routing/google-routing-provider.ts`
- Test: `src/tests/routing.google-transport.test.ts`

**Interfaces:**
- Consumes (Task 1): `RoutingProvider`, `RoutingError`, all of `google-requests.ts`, `FakeRoutingProvider`.
- Produces: `class GoogleRoutingProvider(cfg: GoogleConfig, fetchFn?: typeof fetch, now?: () => number)`, `interface GoogleConfig { apiKey; saEmail; saPrivateKey; projectId }`, `signJwt(email, privateKey, nowSec): string`, `normalisePrivateKey(k): string`, `routingFromEnv(e?: NodeJS.ProcessEnv): RoutingProvider`.

- [ ] **Step 1: Write the failing test** — `src/tests/routing.google-transport.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { GoogleRoutingProvider, signJwt, normalisePrivateKey, routingFromEnv } from '../services/routing/google-routing-provider';
import { RoutingError, type SolveProblem } from '../services/routing/routing-provider';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY = 'AIza-TEST-KEY';
const cfg = { apiKey: KEY, saEmail: 'bus@proj.iam.gserviceaccount.com', saPrivateKey: privateKey, projectId: 'my-proj' };
const sig = () => new AbortController().signal;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(handlers: Record<string, (init: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url); calls.push({ url: u, init });
    const key = Object.keys(handlers).find((k) => u.startsWith(k));
    if (!key) throw new Error('unexpected ' + u);
    return handlers[key]!(init);
  }) as typeof fetch;
  return { fn, calls };
}
const problem: SolveProblem = { startIso: '2026-10-09T21:00:00.000Z', targetRouteMin: 45, polylines: false,
  vehicles: [{ start: { placeId: 'C' }, end: null, capacity: 2 }],
  stops: [{ point: { placeId: 'A' }, allowedVehicles: null, costs: [], optional: true }] };

describe('service-account JWT', () => {
  it('is RS256-signed with node:crypto and verifies with the public key', () => {
    const jwt = signJwt(cfg.saEmail, privateKey, 1_700_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toMatchObject({ iss: cfg.saEmail,
      aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/cloud-platform', exp: 1_700_003_600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
  });
  it('accepts a \\n-escaped private key from an env var', () => {
    expect(normalisePrivateKey('-----BEGIN X-----\\nabc\\n-----END X-----\\n')).toBe('-----BEGIN X-----\nabc\n-----END X-----');
  });
});

describe('GoogleRoutingProvider', () => {
  it('exchanges the JWT once, caches the token, and calls optimizeTours with it', async () => {
    const { fn, calls } = stubFetch({
      'https://oauth2.googleapis.com/token': () => json({ access_token: 'tok', expires_in: 3600 }),
      'https://routeoptimization.googleapis.com/': () => json({ routes: [{ visits: [{}], transitions: [{ travelDuration: '60s' }, {}] }] }),
    });
    const g = new GoogleRoutingProvider(cfg, fn);
    await g.solve(problem, sig());
    const r = await g.solve(problem, sig());
    expect(r.routes[0]).toMatchObject({ vehicle: 0, stops: [0], legsSec: [60] });
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(1);
    const opt = calls.find((c) => c.url.includes('routeoptimization'))!;
    expect(opt.url).toBe('https://routeoptimization.googleapis.com/v1/projects/my-proj:optimizeTours');
    expect((opt.init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    expect(String(calls[0]!.init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
  });
  it('autocomplete sends the key as a header, never in the body', async () => {
    const { fn, calls } = stubFetch({ 'https://places.googleapis.com/v1/places:autocomplete': () => json({ suggestions: [] }) });
    await new GoogleRoutingProvider(cfg, fn).autocomplete('24 Wynnum', 'sess-123456', 'au', sig());
    expect((calls[0]!.init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe(KEY);
    expect(String(calls[0]!.init.body)).not.toContain(KEY);
  });
  it('matrix chunks at 25 pairs per call', async () => {
    const { fn, calls } = stubFetch({ 'https://routes.googleapis.com/': (init) => {
      const n = JSON.parse(String(init.body)).origins.length;
      return json(Array.from({ length: n }, (_, i) => ({ originIndex: i, destinationIndex: i, duration: '5s', condition: 'ROUTE_EXISTS' })));
    } });
    const pairs = Array.from({ length: 30 }, () => ({ from: { placeId: 'A' }, to: { placeId: 'B' } }));
    expect(await new GoogleRoutingProvider(cfg, fn).matrix(pairs, sig())).toHaveLength(30);
    expect(calls).toHaveLength(2);
  });
  it('times out with a RoutingError when the deadline passes', async () => {
    const { fn } = stubFetch({ 'https://places.googleapis.com/': (init) => new Promise<Response>((_, reject) =>
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')))) });
    await expect(new GoogleRoutingProvider(cfg, fn).autocomplete('24 Wynnum', 's-12345678', '', AbortSignal.timeout(20)))
      .rejects.toThrow(/timed out/);
  });
  it('a failed map call never echoes the key', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fn } = stubFetch({ 'https://maps.googleapis.com/': () => new Response(`The provided API key ${KEY} is invalid`, { status: 403 }) });
    const p = new GoogleRoutingProvider(cfg, fn).staticMap([], [], sig());
    await expect(p).rejects.toThrow(RoutingError);
    await expect(p).rejects.toThrow(/map failed \(403\)/);
    await p.catch((e: Error) => expect(e.message).not.toContain(KEY));
    expect(JSON.stringify(err.mock.calls)).not.toContain(KEY);
    err.mockRestore();
  });
});

describe('routingFromEnv', () => {
  const full = { GOOGLE_MAPS_API_KEY: KEY, GOOGLE_SA_EMAIL: cfg.saEmail, GOOGLE_SA_PRIVATE_KEY: 'k\\nk', GOOGLE_PROJECT_ID: 'p' };
  it('uses the fake when keys are missing or in memory mode (unless BUS_ROUTING=google)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(routingFromEnv({ PERSISTENCE: 'supabase' }).name).toBe('fake');
    expect(routingFromEnv({ ...full, PERSISTENCE: 'memory' }).name).toBe('fake');
    expect(routingFromEnv({ ...full }).name).toBe('fake');
    expect(routingFromEnv({ ...full, PERSISTENCE: 'memory', BUS_ROUTING: 'google' }).name).toBe('google');
    expect(routingFromEnv({ ...full, PERSISTENCE: 'supabase' }).name).toBe('google');
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to check it fails**

Run: `npx vitest run src/tests/routing.google-transport.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/services/routing/google-routing-provider.ts`**

```ts
import { createSign } from 'node:crypto';
import { RoutingError, type RoutingProvider, type SolveProblem, type SolveResult, type PlaceSuggestion, type RoutePoint,
  type MapPath, type MapMarker, type MapImage } from './routing-provider';
import { optimizeToursBody, parseOptimizeTours, autocompleteBody, parseAutocomplete, routeMatrixBody, parseRouteMatrix,
  staticMapUrl, MATRIX_MAX_PAIRS } from './google-requests';
import { FakeRoutingProvider } from './fake-routing-provider';

export interface GoogleConfig { apiKey: string; saEmail: string; saPrivateKey: string; projectId: string }

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Vercel env vars usually hold the PEM with literal "\n" sequences. */
export function normalisePrivateKey(k: string): string { return k.replace(/\\n/g, '\n').trim(); }

export function signJwt(email: string, privateKey: string, nowSec: number): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(privateKey);
  return `${head}.${claims}.${b64url(sig)}`;
}

export class GoogleRoutingProvider implements RoutingProvider {
  readonly name = 'google' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private cfg: GoogleConfig,
    private fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private now: () => number = Date.now) {}

  /** Never put the URL or response body in the thrown message: the static-map URL carries the key. */
  private async call(url: string, init: RequestInit, signal: AbortSignal, what: string): Promise<Response> {
    let res: Response;
    try { res = await this.fetchFn(url, { ...init, signal }); }
    catch { throw new RoutingError(signal.aborted ? `Google ${what} timed out` : `Google ${what} unreachable`); }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[routing] ${what} ${res.status}: ${body.slice(0, 300).split(this.cfg.apiKey).join('***')}`);
      throw new RoutingError(`Google ${what} failed (${res.status})`);
    }
    return res;
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const assertion = signJwt(this.cfg.saEmail, this.cfg.saPrivateKey, Math.floor(this.now() / 1000));
    const res = await this.call(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() }, signal, 'sign-in');
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: this.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async solve(p: SolveProblem, signal: AbortSignal): Promise<SolveResult> {
    const token = await this.accessToken(signal);
    const res = await this.call(`https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(this.cfg.projectId)}:optimizeTours`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(optimizeToursBody(p)) },
      signal, 'route optimisation');
    return parseOptimizeTours(await res.json(), p);
  }

  async autocomplete(input: string, sessionToken: string, regionCode: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
    const res = await this.call('https://places.googleapis.com/v1/places:autocomplete', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.cfg.apiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text' },
      body: JSON.stringify(autocompleteBody(input, sessionToken, regionCode)) }, signal, 'address search');
    return parseAutocomplete(await res.json());
  }

  async matrix(pairs: { from: RoutePoint; to: RoutePoint }[], signal: AbortSignal): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < pairs.length; i += MATRIX_MAX_PAIRS) {
      const chunk = pairs.slice(i, i + MATRIX_MAX_PAIRS);
      const res = await this.call('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.cfg.apiKey,
          'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition' },
        body: JSON.stringify(routeMatrixBody(chunk)) }, signal, 'travel times');
      out.push(...parseRouteMatrix(await res.json(), chunk.length));
    }
    return out;
  }

  async staticMap(paths: MapPath[], markers: MapMarker[], signal: AbortSignal): Promise<MapImage> {
    const res = await this.call(staticMapUrl(paths, markers, this.cfg.apiKey), { method: 'GET' }, signal, 'map');
    return { contentType: res.headers.get('content-type') ?? 'image/png', bytes: new Uint8Array(await res.arrayBuffer()) };
  }
}

/**
 * Fake when any Google var is missing, or in PERSISTENCE=memory (dev/tests) unless
 * BUS_ROUTING=google — the owner's "memory mode + a real key" check (spec §10).
 */
export function routingFromEnv(e: NodeJS.ProcessEnv = process.env): RoutingProvider {
  const apiKey = e['GOOGLE_MAPS_API_KEY'], saEmail = e['GOOGLE_SA_EMAIL'], key = e['GOOGLE_SA_PRIVATE_KEY'], projectId = e['GOOGLE_PROJECT_ID'];
  const memory = (e['PERSISTENCE'] ?? 'memory') === 'memory';
  if (!apiKey || !saEmail || !key || !projectId || (memory && e['BUS_ROUTING'] !== 'google')) {
    if (!memory) console.warn('[routing] Google env not set — Bus Ministry uses straight-line fake routes');
    return new FakeRoutingProvider();
  }
  return new GoogleRoutingProvider({ apiKey, saEmail, saPrivateKey: normalisePrivateKey(key), projectId });
}
```

- [ ] **Step 4: Run the test to check it passes**

Run: `npx vitest run src/tests/routing.google-transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification** — `npm run typecheck && npx vitest run && node scripts/check-spa-syntax.js`. Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/services/routing/google-routing-provider.ts src/tests/routing.google-transport.test.ts
git commit -m "feat(bus): Google routing transport — node:crypto JWT, cached token, fetch with deadline (R2)"
```

---

### Task 3: R2 server — planning helpers, lock/undo repo methods, Generate / Fit in / Undo, Move + own-car re-ordering, autocomplete, routes

**Files:**
- Create: `src/services/bus-plan.ts`, `src/tests/helpers/bus-fixtures.ts`, `src/tests/bus-plan.test.ts`, `src/tests/bus.generate.test.ts`
- Modify: `src/core/entities/bus.ts`, `src/core/ministry-config.ts`, `src/repositories/interfaces/entity-repositories.ts` (`IBusRepository`), `src/repositories/in-memory/in-memory.bus.ts`, `src/repositories/supabase/supabase.bus.ts`, `src/services/bus.service.ts`, `src/api/controllers/bus.controller.ts`, `src/api/http/router.ts`, `src/container.ts`
- Test (append): `src/tests/bus.repo.test.ts`, `src/tests/bus.routes.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `RoutingProvider`, `SolveProblem`, `SolveResult`, `PlaceSuggestion`, `routingDeadline`, `RoutingError`, `FakeRoutingProvider`, `routingFromEnv`.
- Produces:
  - `bus-plan.ts`: `autoFillPool(cars, pool, genderOf, need): Map<string, string[]>`, `riderCost(rider, eligibility, prefGrades, w): number`, `endPlaceOf(endsAt, endsPlaceId, churchPlaceId): string | null`, `leaveIso(serviceDate, leaveTime): string`, `interface FleetCar`, `interface FleetRider`, `buildFleetProblem(mode, cars, riders, churchPlaceId, startIso, w): { problem; stopRiderIds }`, `buildSingleProblem(placeIds, churchPlaceId, endPlaceId, startIso, targetRouteMin): SolveProblem`, `placementsFrom(result, stopRiderIds, carIds): Map<riderId, { runVehicleId; stopOrder }>`.
  - `IBusRepository`: `tryLock(runId, by, nowIso, untilIso): Promise<BusRun | null>`, `releaseLock(runId): Promise<void>`, `setUndo(runId, snapshot: BusUndoEntry[] | null, untilIso: string | null): Promise<void>`, `setPoolIds(runId, ids: string[]): Promise<void>`.
  - `BusService`: `autocomplete(ctx, q, session): Promise<PlaceSuggestion[]>`, `generate(ctx, input: { mode: 'all' | 'fit' }): Promise<BusGenerateResult>`, `undo(ctx): Promise<void>`.
  - `makeBusService(bus, students, leaders, settingsRepo, routing: RoutingProvider = new FakeRoutingProvider())`.
  - Internal to `bus.service.ts`, reused by Task 5: `prepareFleet(c, run, mode): Promise<FleetPrep>`, `reorderCar(c, run, rv)`, `routingFailed(err, message?)`, `lockActive(run)`, `lockConflict(run)`, constants `NO_CHURCH`, `GENERATE_FAILED`.
  - Entities: `BusGenerateResult { placed; unassigned; noAddressPin; routeMin: Record<string, number> }`. `MyCarView.churchPlaceId: string`.
  - HTTP: `GET /bus/places/autocomplete?q=&session=` → `PlaceSuggestion[]`. `POST /bus/run/generate {mode}` → `BusGenerateResult` (409 locked, 502 `ROUTING_FAILED`, 400 no church pin / no running car). `POST /bus/run/undo` → `{ ok: true }` (400 when there is nothing to undo or it has expired).

- [ ] **Step 1: Write the test fixture** — `src/tests/helpers/bus-fixtures.ts` (not a test file; R2/R3 tests share it)

```ts
import { makeBusService, type BusCtx } from '../../services/bus.service';
import { InMemoryBusRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemorySettingsRepository } from '../../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../../core/ministry-config';
import { FakeRoutingProvider } from '../../services/routing/fake-routing-provider';
import type { RoutingProvider, SolveProblem, MapPath, MapMarker } from '../../services/routing/routing-provider';
import type { Actor } from '../../core/entities/user';
import type { Student } from '../../core/entities/student';
import type { Leader } from '../../core/entities/leader';

export const FRI_7PM = '2026-10-09T19:00';
const T = '2026-01-01T00:00:00.000Z';

/** Wraps a provider (default: fake) and records exactly what would be sent to Google. */
export function recordingRouting(inner: RoutingProvider = new FakeRoutingProvider()) {
  const calls = { solve: [] as SolveProblem[], autocomplete: [] as { input: string; session: string; region: string }[],
    matrix: 0, map: [] as { paths: MapPath[]; markers: MapMarker[] }[] };
  const provider: RoutingProvider = {
    name: 'fake',
    solve: (p, s) => { calls.solve.push(p); return inner.solve(p, s); },
    autocomplete: (i, t, r, s) => { calls.autocomplete.push({ input: i, session: t, region: r }); return inner.autocomplete(i, t, r, s); },
    matrix: (pairs, s) => { calls.matrix++; return inner.matrix(pairs, s); },
    staticMap: (paths, markers, s) => { calls.map.push({ paths, markers }); return inner.staticMap(paths, markers, s); },
  };
  return { provider, calls };
}

/** Fake provider with some methods replaced. */
export function stubRouting(over: Partial<Pick<RoutingProvider, 'solve' | 'autocomplete' | 'matrix' | 'staticMap'>>): RoutingProvider {
  const f = new FakeRoutingProvider();
  return {
    name: 'fake',
    solve: over.solve ?? ((p, s) => f.solve(p, s)),
    autocomplete: over.autocomplete ?? ((a, b, c, s) => f.autocomplete(a, b, c, s)),
    matrix: over.matrix ?? ((p, s) => f.matrix(p, s)),
    staticMap: over.staticMap ?? ((p, m, s) => f.staticMap(p, m, s)),
  };
}

const student = (id: string, first: string, last: string, grade: number, gender: 'male' | 'female', mobile: string | null = null): Student => ({
  id, firstName: first, lastName: last, gender, grade, quad: null, mobile, parentPhone: null, dateOfBirth: null,
  svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
  prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
  atRiskStatus: null, dataSource: null, createdAt: T, updatedAt: T,
});
const leader = (id: string, name: string, gender: 'male' | 'female' | null): Leader => ({
  id, fullName: name, gender, grades: [], active: true, createdByGrade: null, smsTemplate: null, createdAt: T, updatedAt: T,
});

export async function busFixture(opts: { routing?: RoutingProvider; churchPlaceId?: string } = {}) {
  const bus = new InMemoryBusRepository(); const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository(); const settings = new InMemorySettingsRepository();
  await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
  await settings.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, {
    modules: { busMinistry: true },
    busMinistry: { visibility: 'all', churchAddress: '1 Church St, Testville', churchPlaceId: opts.churchPlaceId ?? 'fake:church', regionCode: 'au' },
  }) });
  await students.save(student('s1', 'Jess', 'Tran', 9, 'female', '0412345678'));
  await students.save(student('s2', 'Sam', 'Ode', 8, 'male', '0499888777'));
  await students.save(student('s3', 'Riley', 'Kim', 10, 'male'));
  await students.save(student('s4', 'Mia', 'Lee', 9, 'female'));
  await leaders.save(leader('L1', 'Tom', 'male'));
  await leaders.save(leader('L2', 'Sarah', 'female'));
  await leaders.save(leader('L3', 'Amy', 'female'));
  await leaders.save(leader('L4', 'Ben', 'male'));
  const svc = makeBusService(bus, students, leaders, settings, opts.routing ?? new FakeRoutingProvider());
  const ctx = (role: string, asLeaderId: string | null = null): BusCtx => ({
    actor: { id: 'u-' + role, role, displayName: role.toUpperCase(), grade: null, quad: null, leaderId: null } as unknown as Actor,
    asLeaderId, localNow: FRI_7PM });
  const admin = ctx('admin');
  /** A fleet vehicle running tonight with these leaders. Returns the run-vehicle id. */
  async function car(name: string, seats: number, leaderIds: string[],
    extra: { prefGrades?: number[]; endsAt?: 'church' | 'last_drop' | 'address' } = {}): Promise<string> {
    const v = await svc.saveVehicle(admin, { name, seats, prefGrades: extra.prefGrades ?? [], endsAt: extra.endsAt ?? 'church' });
    const rv = (await svc.getRun(admin)).vehicles.find((x) => x.vehicleId === v.id)!;
    await svc.updateRunVehicle(admin, rv.id, { leaderIds });
    return rv.id;
  }
  async function rider(studentId: string, placeId: string | null = `fake:${studentId}`) {
    return svc.addRider(admin, { studentId, newAddress: { label: 'Home', address: `${studentId} Test St, Testville`, placeId } });
  }
  return { svc, bus, students, leaders, settings, ctx, admin, car, rider };
}
```

- [ ] **Step 2: Write the failing tests** — `src/tests/bus-plan.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { autoFillPool, riderCost, endPlaceOf, leaveIso, buildFleetProblem, buildSingleProblem, placementsFrom, type FleetCar } from '../services/bus-plan';

const W = { targetRouteMin: 45, genderWeightMin: 120, prefWeightMin: 10 };
const mixed = { female: true, male: true, unknown: false };
const boysOnly = { female: false, male: true, unknown: false };
const unknown = { female: false, male: false, unknown: true };

describe('autoFillPool', () => {
  const g: Record<string, 'male' | 'female'> = { M1: 'male', F1: 'female', F3: 'female', M2: 'male' };
  it('keeps fixed leaders and picks pool leaders so girl/boy seats match the roster', () => {
    const out = autoFillPool(
      [{ id: 'A', seats: 10, leaderIds: ['M1'] }, { id: 'B', seats: 8, leaderIds: [] }],
      [{ id: 'F1', gender: 'female' }, { id: 'M2', gender: 'male' }, { id: 'F3', gender: 'female' }],
      (id) => g[id] ?? null, { female: 8, male: 4 });
    expect(out.get('A')).toEqual(['M1', 'F1']);
    expect(out.get('B')).toEqual(['F3', 'M2']);
  });
  it('leaves cars with 2 leaders alone and does nothing with an empty pool', () => {
    expect(autoFillPool([{ id: 'A', seats: 8, leaderIds: ['M1', 'F1'] }], [{ id: 'F3', gender: 'female' }], (id) => g[id] ?? null, { female: 1, male: 1 }).size).toBe(0);
    expect(autoFillPool([{ id: 'A', seats: 8, leaderIds: [] }], [], () => null, { female: 1, male: 1 }).size).toBe(0);
  });
});

describe('riderCost', () => {
  it('gender penalty when leaders do not cover the rider; unknown-gender leaders cover neither', () => {
    expect(riderCost({ gender: 'female', grade: null }, boysOnly, [], W)).toBe(120);
    expect(riderCost({ gender: 'male', grade: null }, boysOnly, [], W)).toBe(0);
    expect(riderCost({ gender: 'male', grade: null }, unknown, [], W)).toBe(120);
    expect(riderCost({ gender: null, grade: null }, unknown, [], W)).toBe(0);
  });
  it('grade penalty only when the car has preferred grades', () => {
    expect(riderCost({ gender: null, grade: 9 }, mixed, [10, 11], W)).toBe(10);
    expect(riderCost({ gender: null, grade: 9 }, mixed, [], W)).toBe(0);
    expect(riderCost({ gender: 'female', grade: 9 }, boysOnly, [10], W)).toBe(130);
  });
});

describe('fleet problem', () => {
  const cars: FleetCar[] = [
    { id: 'A', capacity: 5, eligibility: boysOnly, prefGrades: [], endPlaceId: 'C' },
    { id: 'B', capacity: 3, eligibility: mixed, prefGrades: [10], endPlaceId: null },
  ];
  const r = (id: string, extra: object = {}) => ({ id, placeId: 'P' + id, gender: 'female' as const, grade: 9, runVehicleId: null, pinned: false, ...extra });
  it('pins, fit mode, penalties, ends and labels', () => {
    const { problem, stopRiderIds } = buildFleetProblem('all', cars,
      [r('1'), r('2', { runVehicleId: 'B', pinned: true }), r('3', { runVehicleId: 'A' })], 'C', '2026-10-09T21:00:00.000Z', W);
    expect(stopRiderIds).toEqual(['1', '2', '3']);
    expect(problem.vehicles).toEqual([{ start: { placeId: 'C' }, end: { placeId: 'C' }, capacity: 5 }, { start: { placeId: 'C' }, end: null, capacity: 3 }]);
    expect(problem.stops[0]).toEqual({ point: { placeId: 'P1' }, allowedVehicles: null,
      costs: [{ vehicle: 0, cost: 120 }, { vehicle: 1, cost: 10 }], optional: true });
    expect(problem.stops[1]!.allowedVehicles).toEqual([1]);   // pinned → its car
    expect(problem.stops[2]!.allowedVehicles).toBeNull();     // placed but not pinned → free in 'all'
    const fit = buildFleetProblem('fit', cars, [r('3', { runVehicleId: 'A' })], 'C', '2026-10-09T21:00:00.000Z', W);
    expect(fit.problem.stops[0]!.allowedVehicles).toEqual([0]); // placed → fixed in 'fit'
  });
  it('single-car problem must place every stop', () => {
    const p = buildSingleProblem(['a', 'b'], 'C', null, '2026-10-09T21:00:00.000Z', 45);
    expect(p.vehicles).toEqual([{ start: { placeId: 'C' }, end: null, capacity: 2 }]);
    expect(p.stops.every((s) => !s.optional && s.allowedVehicles === null)).toBe(true);
  });
  it('placements: 1-based order per car, skipped riders unassigned', () => {
    const m = placementsFrom({ routes: [{ vehicle: 1, stops: [2, 0], legsSec: [], totalSec: 0, polyline: null, legPolylines: [] }], skipped: [1] },
      ['x', 'y', 'z'], ['A', 'B']);
    expect(Object.fromEntries(m)).toEqual({ x: { runVehicleId: 'B', stopOrder: 2 }, y: { runVehicleId: null, stopOrder: null }, z: { runVehicleId: 'B', stopOrder: 1 } });
  });
  it('ends and leave time', () => {
    expect([endPlaceOf('church', null, 'C'), endPlaceOf('last_drop', 'X', 'C'), endPlaceOf('address', 'X', 'C'), endPlaceOf('address', null, 'C')])
      .toEqual(['C', null, 'X', null]);
    expect(leaveIso('2026-10-09', '21:00')).toBe('2026-10-09T21:00:00.000Z');
  });
});
```

`src/tests/bus.generate.test.ts`

```ts
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
    for (const pii of ['Jess', 'Tran', 'Sam', 'Ode', '0412345678', '0499888777', 'Tom', 'Sarah', 'Van']) expect(sent).not.toContain(pii);
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
```

Append to `src/tests/bus.repo.test.ts` (it already defines `run(id, date)`):

```ts
describe('run lock + undo (R2)', () => {
  it('tryLock only succeeds when unlocked or expired; release/setUndo/setPoolIds touch only their own fields', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    await r.insertRunIfAbsent(run('a', '2026-10-09'));
    const t0 = '2026-10-09T09:00:00.000Z', t30 = '2026-10-09T09:00:30.000Z';
    expect((await r.tryLock('a', 'Sarah', t0, t30))!.lockBy).toBe('Sarah');
    expect(await r.tryLock('a', 'Tom', '2026-10-09T09:00:10.000Z', '2026-10-09T09:00:40.000Z')).toBeNull();
    expect((await r.tryLock('a', 'Tom', '2026-10-09T09:00:31.000Z', '2026-10-09T09:01:01.000Z'))!.lockBy).toBe('Tom');
    await r.setPoolIds('a', ['L1']);
    expect(await r.getRun('a')).toMatchObject({ lockBy: 'Tom', availablePoolLeaderIds: ['L1'] });
    await r.setUndo('a', [{ riderId: 'x', runVehicleId: null, stopOrder: null, pinned: false }], t30);
    await r.releaseLock('a');
    expect(await r.getRun('a')).toMatchObject({ lockBy: null, lockUntil: null, undoUntil: t30, availablePoolLeaderIds: ['L1'] });
  });
});
```

Append to `src/tests/bus.routes.test.ts`:

```ts
describe('R2 routes', () => {
  it('registers autocomplete, generate and undo (authenticated)', async () => {
    const { services } = await buildContainer();
    const routes = buildRoutes(services).filter((r) => r.path.startsWith('/bus'));
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(expect.arrayContaining(['GET /bus/places/autocomplete', 'POST /bus/run/generate', 'POST /bus/run/undo']));
    expect(routes.every((r) => r.auth)).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to check they fail**

Run: `npx vitest run src/tests/bus-plan.test.ts src/tests/bus.generate.test.ts src/tests/bus.repo.test.ts src/tests/bus.routes.test.ts`
Expected: FAIL, `bus-plan` missing, `regionCode` not in the schema, `svc.generate is not a function`, `tryLock is not a function`.

- [ ] **Step 4: Config + entities**

In `src/core/ministry-config.ts`, inside the `busMinistry` object, after `coordinatorLeaderIds`:

```ts
      // ISO 3166-1 alpha-2 (e.g. 'au'); '' = search addresses everywhere. Autocomplete includedRegionCodes.
      regionCode: z.string().regex(/^([A-Za-z]{2})?$/).default(''),
```

In `src/core/entities/bus.ts`, add `churchPlaceId: string;` to `MyCarView` after `churchAddress: string;`, then append:

```ts
export interface BusGenerateResult {
  placed: number;                     // riders the solver put in a car
  unassigned: number;                 // riders with no car after this generate (incl. own-car-less, no-pin, pinned-unassigned)
  noAddressPin: number;               // riders never sent to Google because their address has no place ID
  routeMin: Record<ID, number>;       // run vehicle id → drive minutes from this solve (not persisted)
}
```

- [ ] **Step 5: Write `src/services/bus-plan.ts`**

```ts
import type { BusEligibility, BusGender, EndsAt } from '../core/entities/bus';
import type { SolveProblem, SolveResult, SolveStop } from './routing/routing-provider';

export interface Weights { targetRouteMin: number; genderWeightMin: number; prefWeightMin: number }

/**
 * Pool auto-fill (spec §7): fixed/tonight leaders stay; each car under 2 leaders takes available
 * pool leaders, picking the gender that is shortest of seats for tonight's roster split. Returns
 * new leaderIds only for cars that changed. Pure — the caller decides whether to save.
 */
export function autoFillPool(cars: { id: string; seats: number; leaderIds: string[] }[], pool: { id: string; gender: BusGender }[],
  genderOf: (leaderId: string) => BusGender, need: { female: number; male: number }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const left = [...pool];
  const lead = new Map(cars.map((c) => [c.id, [...c.leaderIds]]));
  const seatsFor = (g: 'female' | 'male') => cars.reduce((n, c) => {
    const ids = lead.get(c.id)!;
    return ids.some((id) => genderOf(id) === g) ? n + Math.max(0, c.seats - ids.length) : n;
  }, 0);
  for (const c of cars) {
    const ids = lead.get(c.id)!;
    while (ids.length < 2 && left.length) {
      const gapF = need.female - seatsFor('female'), gapM = need.male - seatsFor('male');
      const hasF = ids.some((id) => genderOf(id) === 'female');
      const want: BusGender = gapF > gapM ? 'female' : gapM > gapF ? 'male' : !hasF ? 'female' : 'male';
      const i = Math.max(0, left.findIndex((l) => l.gender === want));
      ids.push(left.splice(i, 1)[0]!.id);
      out.set(c.id, ids);
    }
  }
  return out;
}

/** Penalty minutes for a rider in a car (spec §7). A leader with no gender covers neither. */
export function riderCost(r: { gender: BusGender; grade: number | null }, elig: BusEligibility, prefGrades: number[],
  w: Pick<Weights, 'genderWeightMin' | 'prefWeightMin'>): number {
  let cost = 0;
  if (r.gender && !elig[r.gender]) cost += w.genderWeightMin;
  if (r.grade != null && prefGrades.length && !prefGrades.includes(r.grade)) cost += w.prefWeightMin;
  return cost;
}

export function endPlaceOf(endsAt: EndsAt, endsPlaceId: string | null, churchPlaceId: string): string | null {
  return endsAt === 'church' ? churchPlaceId : endsAt === 'address' ? endsPlaceId : null;
}

/** Nominal leave time. Traffic is off, so labelling local time as UTC changes no drive times. */
export function leaveIso(serviceDate: string, leaveTime: string): string { return `${serviceDate}T${leaveTime}:00.000Z`; }

export interface FleetCar { id: string; capacity: number; eligibility: BusEligibility; prefGrades: number[]; endPlaceId: string | null }
export interface FleetRider { id: string; placeId: string; gender: BusGender; grade: number | null; runVehicleId: string | null; pinned: boolean }

/** 'all' = everyone except pinned is free; 'fit' = already-placed riders are fixed to their car. */
export function buildFleetProblem(mode: 'all' | 'fit', cars: FleetCar[], riders: FleetRider[], churchPlaceId: string, startIso: string,
  w: Weights): { problem: SolveProblem; stopRiderIds: string[] } {
  const idx = new Map(cars.map((c, i) => [c.id, i]));
  const stops: SolveStop[] = riders.map((r) => {
    const own = r.runVehicleId != null ? idx.get(r.runVehicleId) : undefined;
    const fixed = own !== undefined && (r.pinned || mode === 'fit');
    return { point: { placeId: r.placeId }, allowedVehicles: fixed ? [own] : null, optional: true,
      costs: cars.map((c, k) => ({ vehicle: k, cost: riderCost(r, c.eligibility, c.prefGrades, w) })).filter((c) => c.cost > 0) };
  });
  return {
    problem: { startIso, targetRouteMin: w.targetRouteMin, polylines: false, stops,
      vehicles: cars.map((c) => ({ start: { placeId: churchPlaceId }, end: c.endPlaceId ? { placeId: c.endPlaceId } : null, capacity: c.capacity })) },
    stopRiderIds: riders.map((r) => r.id),
  };
}

export function buildSingleProblem(placeIds: string[], churchPlaceId: string, endPlaceId: string | null, startIso: string,
  targetRouteMin: number): SolveProblem {
  return { startIso, targetRouteMin, polylines: false,
    vehicles: [{ start: { placeId: churchPlaceId }, end: endPlaceId ? { placeId: endPlaceId } : null, capacity: placeIds.length }],
    stops: placeIds.map((p) => ({ point: { placeId: p }, allowedVehicles: null, costs: [], optional: false })) };
}

export function placementsFrom(result: SolveResult, stopRiderIds: string[], carIds: string[]):
  Map<string, { runVehicleId: string | null; stopOrder: number | null }> {
  const out = new Map<string, { runVehicleId: string | null; stopOrder: number | null }>();
  for (const id of stopRiderIds) out.set(id, { runVehicleId: null, stopOrder: null });
  for (const r of result.routes) r.stops.forEach((s, i) => out.set(stopRiderIds[s]!, { runVehicleId: carIds[r.vehicle]!, stopOrder: i + 1 }));
  return out;
}
```

- [ ] **Step 6: Repository methods (interface + in-memory + Supabase)**

In `IBusRepository` (`src/repositories/interfaces/entity-repositories.ts`), after `bumpRun(...)`:

```ts
  /** Atomic: sets lock_by/lock_until only if the run is unlocked or the lock has expired; null = someone else holds it. */
  tryLock(runId: string, by: string, nowIso: string, untilIso: string): Promise<BusRun | null>;
  releaseLock(runId: string): Promise<void>;
  setUndo(runId: string, snapshot: BusUndoEntry[] | null, untilIso: string | null): Promise<void>;
  /** Writes ONLY available_pool_leader_ids (saveRun writes the whole row and would clobber a live lock). */
  setPoolIds(runId: string, ids: string[]): Promise<void>;
```

Add `BusUndoEntry` to that file's `../../core/entities/bus` import list.

In `src/repositories/in-memory/in-memory.bus.ts`, after `bumpRun`:

```ts
  async tryLock(id: string, by: string, nowIso: string, untilIso: string) {
    const r = this.runs.get(id);
    if (!r || (r.lockUntil && r.lockUntil > nowIso)) return null;
    r.lockBy = by; r.lockUntil = untilIso;
    return c(r);
  }
  async releaseLock(id: string) { const r = this.runs.get(id); if (r) { r.lockBy = null; r.lockUntil = null; } }
  async setUndo(id: string, snap: BusUndoEntry[] | null, until: string | null) {
    const r = this.runs.get(id); if (r) { r.undoSnapshot = snap ? c(snap) : null; r.undoUntil = until; }
  }
  async setPoolIds(id: string, ids: string[]) { const r = this.runs.get(id); if (r) r.availablePoolLeaderIds = [...ids]; }
```

(add `BusUndoEntry` to its entity import.)

In `src/repositories/supabase/supabase.bus.ts`, after `bumpRun`:

```ts
  async tryLock(id: string, by: string, nowIso: string, untilIso: string) {
    const r = await this.sql`update bus_runs set lock_by = ${by}, lock_until = ${untilIso}
      where id = ${id} and (lock_until is null or lock_until <= ${nowIso}) returning *`;
    return r[0] ? toRun(r[0]) : null;
  }
  async releaseLock(id: string) { await this.sql`update bus_runs set lock_by = null, lock_until = null where id = ${id}`; }
  async setUndo(id: string, snap: BusUndoEntry[] | null, until: string | null) {
    await this.sql`update bus_runs set undo_snapshot = ${snap ? this.j(snap) : null}, undo_until = ${until} where id = ${id}`;
  }
  async setPoolIds(id: string, ids: string[]) {
    await this.sql`update bus_runs set available_pool_leader_ids = ${this.j(ids)} where id = ${id}`;
  }
```

(add `BusUndoEntry` to its entity import.)

- [ ] **Step 7: Service — imports, constants, helpers**

In `src/services/bus.service.ts`:

Replace the `app-error` import with:

```ts
import { AppError, BadRequestError, ConflictError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
```

Add imports:

```ts
import { autoFillPool, buildFleetProblem, buildSingleProblem, endPlaceOf, leaveIso, placementsFrom, type FleetCar } from './bus-plan';
import { FakeRoutingProvider } from './routing/fake-routing-provider';
import { routingDeadline, type RoutingProvider, type PlaceSuggestion, type SolveProblem, type SolveResult } from './routing/routing-provider';
```

Add `BusGenerateResult` to the `../core/entities/bus` type import.

Extend the `BusService` interface (after `getPastRun`):

```ts
  autocomplete(ctx: BusCtx, q: string, session: string): Promise<PlaceSuggestion[]>;
  generate(ctx: BusCtx, input: unknown): Promise<BusGenerateResult>;
  undo(ctx: BusCtx): Promise<void>;
```

After the `DroppedIn` schema, add:

```ts
const GenerateIn = z.object({ mode: z.enum(['all', 'fit']) });
const LOCK_MS = 30_000;
const UNDO_MS = 120_000;
const SESSION_RE = /^[A-Za-z0-9-]{8,36}$/;
const NO_CHURCH = 'Set the church address in Bus settings first';
const GENERATE_FAILED = "Couldn't reach Google Maps — nothing changed. Try again, or move riders by hand.";
const SEARCH_FAILED = 'Address search is unavailable right now. Type the full address instead.';

function routingFailed(err: unknown, message = GENERATE_FAILED): AppError {
  console.error('[bus] routing failed:', err instanceof Error ? err.message : err);
  return new AppError('ROUTING_FAILED', message, 502);
}
const lockActive = (run: BusRun) => !!run.lockUntil && Date.parse(run.lockUntil) > Date.now();
const lockConflict = (run: BusRun) => new ConflictError(`${run.lockBy ?? 'Someone'} is generating routes…`);
```

Change the factory signature:

```ts
export function makeBusService(bus: IBusRepository, students: IStudentRepository,
  leaders: ILeaderRepository, settingsRepo: ISettingsRepository,
  routing: RoutingProvider = new FakeRoutingProvider()): BusService {
```

Inside the factory, after `linkOne(...)` and before `const svc: BusService = {`, add:

```ts
  interface FleetPrep {
    problem: SolveProblem; stopRiderIds: string[];
    cars: BusRunVehicle[];               // running fleet cars, same order as problem.vehicles
    filled: Map<string, string[]>;       // pool auto-fill: run vehicle id → new leaderIds (not yet saved)
    riders: BusRunRider[];               // every rider on the run when prepared
    untouched: BusRunRider[];            // fleet riders with no place ID — never sent to Google
  }
  /** Builds the fleet solve for Generate / Fit in (and R3's "Try +N cars"). Reads only. */
  async function prepareFleet(c: MinistryConfig, run: BusRun, mode: 'all' | 'fit'): Promise<FleetPrep> {
    const b = c.busMinistry;
    const [rvs, riders, all, fleet] = await Promise.all([bus.listRunVehicles(run.id), bus.listRunRiders(run.id), leaders.findAll(), bus.listVehicles()]);
    const genderBy = new Map(all.map((l) => [l.id, genderOf(l.gender)]));
    const known = (ids: string[]) => ids.filter((id) => genderBy.has(id));
    const cars = rvs.filter((v) => v.running && v.vehicleId);
    const ownCarIds = new Set(rvs.filter((v) => v.ownerLeaderId).map((v) => v.id));
    const fleetRiders = riders.filter((r) => !(r.runVehicleId && ownCarIds.has(r.runVehicleId)));
    const busy = new Set(rvs.filter((v) => v.running).flatMap((v) => [...v.leaderIds, ...(v.ownerLeaderId ? [v.ownerLeaderId] : [])]));
    const pool = run.availablePoolLeaderIds.filter((id) => genderBy.has(id) && !busy.has(id)).map((id) => ({ id, gender: genderBy.get(id) ?? null }));
    const need = { female: fleetRiders.filter((r) => r.snapGender === 'female').length, male: fleetRiders.filter((r) => r.snapGender === 'male').length };
    const filled = autoFillPool(cars.map((v) => ({ id: v.id, seats: v.seats, leaderIds: known(v.leaderIds) })), pool, (id) => genderBy.get(id) ?? null, need);
    const untouched = fleetRiders.filter((r) => !r.snapPlaceId);
    // A rider moved to Unassigned by hand (pinned, no car) stays unassigned.
    const solvable = fleetRiders.filter((r) => r.snapPlaceId && !(r.pinned && !r.runVehicleId));
    const fleetCars: FleetCar[] = cars.map((v) => {
      const ids = filled.get(v.id) ?? known(v.leaderIds);
      return { id: v.id,
        capacity: Math.max(0, capacityOf(v.seats, ids.length) - untouched.filter((r) => r.runVehicleId === v.id).length),
        eligibility: eligibilityOf(ids.map((id) => genderBy.get(id) ?? null)),
        prefGrades: fleet.find((f) => f.id === v.vehicleId)?.prefGrades ?? [],
        endPlaceId: endPlaceOf(v.endsAt, v.endsPlaceId, b.churchPlaceId) };
    });
    const { problem, stopRiderIds } = buildFleetProblem(mode, fleetCars,
      solvable.map((r) => ({ id: r.id, placeId: r.snapPlaceId!, gender: r.snapGender, grade: r.snapGrade, runVehicleId: r.runVehicleId, pinned: r.pinned })),
      b.churchPlaceId, leaveIso(run.serviceDate, b.leaveTime), b);
    return { problem, stopRiderIds, cars, filled, riders, untouched };
  }

  /** Single-car solve for one car's stop order (Move, own car). No church pin / Google down → keep the current order. */
  async function reorderCar(c: MinistryConfig, run: BusRun, rv: BusRunVehicle): Promise<void> {
    const b = c.busMinistry;
    const inCar = (await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === rv.id)
      .sort((x, y) => (x.stopOrder ?? 999) - (y.stopOrder ?? 999));
    const mapped = inCar.filter((x) => x.snapPlaceId);
    if (!b.churchPlaceId || mapped.length < 2) return;
    try {
      const res = await routing.solve(buildSingleProblem(mapped.map((x) => x.snapPlaceId!), b.churchPlaceId,
        endPlaceOf(rv.endsAt, rv.endsPlaceId, b.churchPlaceId), leaveIso(run.serviceDate, b.leaveTime), b.targetRouteMin), routingDeadline());
      const order = res.routes[0]?.stops ?? [];
      if (order.length !== mapped.length) return;
      const next = [...order.map((i) => mapped[i]!), ...inCar.filter((x) => !x.snapPlaceId)];
      for (const [i, x] of next.entries()) if (x.stopOrder !== i + 1) await bus.saveRunRider({ ...x, stopOrder: i + 1 });
    } catch (err) {
      console.error('[bus] reorder skipped:', err instanceof Error ? err.message : err);
    }
  }
```

- [ ] **Step 8: Service — change R1 methods**

`setPool`: replace `await bus.saveRun({ ...run, availablePoolLeaderIds: v.availableLeaderIds });` with:

```ts
      await bus.setPoolIds(run.id, v.availableLeaderIds);
```

`moveRider`: after `const run = await writableRun(ctx, c);` add `if (lockActive(run)) throw lockConflict(run);`. Replace the last three lines (from `const saved = await bus.saveRunRider({ ...r, runVehicleId: rv.id, stopOrder: maxStop + 1, pinned: true });` to the `return`) with:

```ts
      const saved = await bus.saveRunRider({ ...r, runVehicleId: rv.id, stopOrder: maxStop + 1, pinned: true });
      await reorderCar(c, run, rv); // R1 appended last; R2 re-orders with a single-car solve (falls back to appended)
      await touch(ctx, run);
      const fresh = (await bus.getRunRider(saved.id)) ?? saved;
      return riderView(fresh, await consentOf(fresh));
```

`saveOwnCar`: after the `for (const [i, id] of v.riderIds.entries()) { … }` loop add:

```ts
      await reorderCar(c, run, rv);
```

`myCar`: change the return to:

```ts
      return { vehicle, stops, churchAddress: c.busMinistry.churchAddress, churchPlaceId: c.busMinistry.churchPlaceId, ownCarDraft };
```

- [ ] **Step 9: Service — new methods** (add inside the `svc` object, after `getPastRun`)

```ts
    async autocomplete(ctx, q, session) {
      const c = await gate(ctx, 'bus:use');
      const input = q.trim();
      if (input.length < 3 || input.length > 120) return [];
      const token = SESSION_RE.test(session) ? session : generateId();
      try { return await routing.autocomplete(input, token, c.busMinistry.regionCode, routingDeadline()); }
      catch (err) { throw routingFailed(err, SEARCH_FAILED); }
    },
    async generate(ctx, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const { mode } = parseIn(GenerateIn, input);
      if (!c.busMinistry.churchPlaceId) throw new BadRequestError(NO_CHURCH);
      const run = await writableRun(ctx, c);
      const t0 = Date.now();
      if (!(await bus.tryLock(run.id, await whoLabel(ctx), new Date(t0).toISOString(), new Date(t0 + LOCK_MS).toISOString())))
        throw lockConflict((await bus.getRun(run.id)) ?? run);
      try {
        const prep = await prepareFleet(c, run, mode);
        if (!prep.problem.vehicles.length) throw new BadRequestError('Turn on at least one car in Car setup');
        let result: SolveResult;
        try { result = prep.problem.stops.length ? await routing.solve(prep.problem, routingDeadline()) : { routes: [], skipped: [] }; }
        catch (err) { throw routingFailed(err); }
        const carIds = prep.cars.map((v) => v.id);
        const placed = placementsFrom(result, prep.stopRiderIds, carIds);
        const before = new Map(prep.riders.map((r) => [r.id, r]));
        // saveRunRider is an upsert: only write riders that still exist and weren't moved while Google was solving.
        const unchanged = (r: BusRunRider) => { const b0 = before.get(r.id); return !!b0 && b0.runVehicleId === r.runVehicleId && b0.pinned === r.pinned; };
        const current = await bus.listRunRiders(run.id);
        await bus.setUndo(run.id, prep.riders.map((r) => ({ riderId: r.id, runVehicleId: r.runVehicleId, stopOrder: r.stopOrder, pinned: r.pinned })),
          new Date(Date.now() + UNDO_MS).toISOString());
        for (const r of current) {
          const p = placed.get(r.id);
          if (!p || !unchanged(r)) continue;
          await bus.saveRunRider({ ...r, runVehicleId: p.runVehicleId, stopOrder: p.stopOrder, pinned: p.runVehicleId ? r.pinned : false });
        }
        // Riders with no map pin keep their seat, after the solved stops.
        for (const id of carIds) {
          let n = [...placed.values()].filter((p) => p.runVehicleId === id).length;
          for (const r of current.filter((x) => x.runVehicleId === id && !x.snapPlaceId && unchanged(x))) await bus.saveRunRider({ ...r, stopOrder: ++n });
        }
        const live = new Map((await bus.listRunVehicles(run.id)).map((v) => [v.id, v]));
        for (const [id, leaderIds] of prep.filled) { const v = live.get(id); if (v) await bus.saveRunVehicle({ ...v, leaderIds }); }
        await touch(ctx, run);
        return {
          placed: [...placed.values()].filter((p) => p.runVehicleId).length,
          unassigned: (await bus.listRunRiders(run.id)).filter((r) => !r.runVehicleId).length,
          noAddressPin: prep.untouched.length,
          routeMin: Object.fromEntries(result.routes.map((rt) => [carIds[rt.vehicle]!, Math.round(rt.totalSec / 60)])),
        };
      } finally {
        await bus.releaseLock(run.id);
      }
    },
    async undo(ctx) {
      const c = await gate(ctx, 'bus:coordinate');
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      if (!run.undoSnapshot || !run.undoUntil || Date.parse(run.undoUntil) < Date.now()) throw new BadRequestError('Nothing to undo');
      const snap = new Map(run.undoSnapshot.map((e) => [e.riderId, e]));
      const running = new Set((await bus.listRunVehicles(run.id)).filter((v) => v.running).map((v) => v.id));
      for (const r of await bus.listRunRiders(run.id)) {
        const e = snap.get(r.id);
        if (!e) continue; // added after the generate — leave alone
        const car = e.runVehicleId && running.has(e.runVehicleId) ? e.runVehicleId : null;
        await bus.saveRunRider({ ...r, runVehicleId: car, stopOrder: car ? e.stopOrder : null, pinned: e.pinned });
      }
      await bus.setUndo(run.id, null, null);
      await touch(ctx, run);
    },
```

- [ ] **Step 10: Controller, routes, container**

`src/api/controllers/bus.controller.ts`: add to the returned object:

```ts
    autocomplete: (r: HttpRequest) => b.autocomplete(ctxOf(r), String(r.query['q'] ?? ''), String(r.query['session'] ?? '')),
    generate: (r: HttpRequest) => b.generate(ctxOf(r), r.body),
    undo: async (r: HttpRequest) => { await b.undo(ctxOf(r)); return { ok: true }; },
```

`src/api/http/router.ts`: after the `/bus/runs/:id` line:

```ts
    { method: 'GET',    path: '/bus/places/autocomplete', auth: true, handler: (r) => busCtl.autocomplete(r) },
    { method: 'POST',   path: '/bus/run/generate',        auth: true, handler: (r) => busCtl.generate(r) },
    { method: 'POST',   path: '/bus/run/undo',            auth: true, handler: (r) => busCtl.undo(r) },
```

`src/container.ts`: import `import { routingFromEnv } from './services/routing/google-routing-provider';` and change to `const busSvc = makeBusService(bus, students, leaders, settings, routingFromEnv());`.

- [ ] **Step 11: Run the new tests to check they pass**

Run: `npx vitest run src/tests/bus-plan.test.ts src/tests/bus.generate.test.ts src/tests/bus.repo.test.ts src/tests/bus.routes.test.ts src/tests/bus.service.test.ts`
Expected: PASS. All R1 tests still pass: R1's setup has no church pin, so Move keeps its append behaviour there.

- [ ] **Step 12: Full verification** — `npm run typecheck && npx vitest run && node scripts/check-spa-syntax.js`. Expected: green.

- [ ] **Step 13: Commit**

```bash
git add src/services/bus-plan.ts src/core/entities/bus.ts src/core/ministry-config.ts src/repositories/interfaces/entity-repositories.ts src/repositories/in-memory/in-memory.bus.ts src/repositories/supabase/supabase.bus.ts src/services/bus.service.ts src/api/controllers/bus.controller.ts src/api/http/router.ts src/container.ts src/tests/helpers/bus-fixtures.ts src/tests/bus-plan.test.ts src/tests/bus.generate.test.ts src/tests/bus.repo.test.ts src/tests/bus.routes.test.ts
git commit -m "feat(bus): Generate / Fit in / Undo with lock, pool auto-fill, single-car re-order, address autocomplete (R2)"
```

---

### Task 4: R2 SPA — autocomplete, Generate / Fit in / Re-generate all, lock banner, Undo toast, Maps links with place IDs

**Files:**
- Modify: `public/index.html` (BUS MODULE CSS block, BUS MODULE JS block, `MINISTRY_CONFIG_DEFAULTS_CLIENT` busMinistry line ~5991), `public/sw.js`
- Test (append): `src/tests/spa-bus.test.ts`

**Interfaces:**
- Consumes (Task 3): `GET /bus/places/autocomplete?q=&session=`, `POST /bus/run/generate {mode}` → `{ placed, unassigned, noAddressPin, routeMin }`, `POST /bus/run/undo`, `BusRunView.run.lockBy/lockUntil/undoUntil`, `BusRiderView.placeId/pinned`, `MyCarView.churchPlaceId`, `busMinistry.churchPlaceId/regionCode`.
- Produces (SPA, used by Task 6): `BUS.routeMin`, `_busFitCount(view)`, `_busLockedBy(view, nowMs, generating)`, `_busAcField(id, value, placeId, placeholder)`, `_busAcValue(id)`, `_busAcResolve(state, text)`, `_busMapsLinks(stops, church, car, churchPlaceId)`.

- [ ] **Step 1: Write the failing SPA tests** (append to `src/tests/spa-bus.test.ts`)

```ts
describe('R2 SPA helpers', () => {
  it('_busAcResolve keeps the place ID only while the text is the picked suggestion', () => {
    const { _busAcResolve } = loadFns(['_busAcResolve']);
    const st = { text: '24 Wynnum Rd, Carina', placeId: 'P1' };
    expect(_busAcResolve(st, ' 24 Wynnum Rd, Carina ')).toBe('P1');
    expect(_busAcResolve(st, '24 Wynnum Rd, Carina East')).toBeNull();
    expect(_busAcResolve(undefined, 'x')).toBeNull();
  });
  it('_busFitCount counts unplaced, unpinned riders that have a map pin', () => {
    const { _busFitCount } = loadFns(['_busFitCount']);
    const v = { riders: [
      { runVehicleId: null, pinned: false, placeId: 'P' }, { runVehicleId: null, pinned: true, placeId: 'P' },
      { runVehicleId: null, pinned: false, placeId: null }, { runVehicleId: 'c', pinned: false, placeId: 'P' }] };
    expect(_busFitCount(v)).toBe(1);
  });
  it('_busLockedBy names the holder only while the lock is live and not our own generate', () => {
    const { _busLockedBy } = loadFns(['_busLockedBy']);
    const now = Date.parse('2026-10-09T09:00:00.000Z');
    const v = (until: string | null) => ({ run: { lockBy: 'Sarah', lockUntil: until } });
    expect(_busLockedBy(v('2026-10-09T09:00:20.000Z'), now, false)).toBe('Sarah');
    expect(_busLockedBy(v('2026-10-09T08:59:59.000Z'), now, false)).toBeNull();
    expect(_busLockedBy(v('2026-10-09T09:00:20.000Z'), now, true)).toBeNull();
    expect(_busLockedBy(v(null), now, false)).toBeNull();
  });
  it('Maps links carry origin/destination/waypoint place IDs', () => {
    const { _busMapsLinks } = loadFns(['_busMapsLinks']);
    const stops = [{ address: '1 A St', placeId: 'PA' }, { address: '2 B St', placeId: 'PB' }];
    const u = new URL(_busMapsLinks(stops, '1 Church Rd', { endsAt: 'church' }, 'PC')[0].url);
    expect([u.searchParams.get('origin_place_id'), u.searchParams.get('destination_place_id'), u.searchParams.get('waypoint_place_ids')])
      .toEqual(['PC', 'PC', 'PA|PB']);
    const d = new URL(_busMapsLinks(stops, '1 Church Rd', { endsAt: 'last_drop' }, 'PC')[0].url);
    expect([d.searchParams.get('destination_place_id'), d.searchParams.get('waypoint_place_ids')]).toEqual(['PB', 'PA']);
    const e = new URL(_busMapsLinks(stops, '1 Church Rd', { endsAt: 'address', endsAddress: '9 End St', endsPlaceId: 'PE' }, 'PC')[0].url);
    expect(e.searchParams.get('destination_place_id')).toBe('PE');
  });
});
```

- [ ] **Step 2: Run them to check they fail**

Run: `npx vitest run src/tests/spa-bus.test.ts`
Expected: FAIL, "could not find function _busAcResolve" and the place-ID assertions.

- [ ] **Step 3: State + config mirror**

In the `const BUS = { … }` line, add these fields before the closing `}`:

```js
ac: {}, acHits: {}, generating: false, routeMin: {}, undoTimer: null
```

In `MINISTRY_CONFIG_DEFAULTS_CLIENT`'s `busMinistry` object (~line 5991), add `regionCode: ''` after `coordinatorLeaderIds: []`.

In `busRefresh()`, change `if (gen === BUS.gen) { BUS.view = view; …` to clear route minutes when the night changes:

```js
      if (gen === BUS.gen) { if (BUS.view && BUS.view.run.id !== view.run.id) BUS.routeMin = {}; BUS.view = view; BUS.version = view.run.version; BUS.myCar = myCar; BUS.failed = false; }
```

- [ ] **Step 4: Autocomplete field** (add right after `_busHitsHtml()`)

```js
// ── Address autocomplete (R2): Google suggestions via our server only; the place ID is kept
// only while the input still holds the picked suggestion's text.
function _busUuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
function _busAcField(id, value, placeId, placeholder) {
  BUS.ac[id] = { text: value || '', placeId: placeId || null, session: _busUuid() };
  return `<div class="bus-ac"><input class="fi" id="${id}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" autocomplete="off"
      autocapitalize="off" autocorrect="off" spellcheck="false" oninput="busAc('${id}', this.value)">
    <div class="bus-ac-list" id="${id}-ac"></div></div>`;
}
let _busAcT = null;
function busAc(id, q) {
  if (id === 'bus-addr-text') { const r = document.querySelector('input[name="bus-addr"][value="new"]'); if (r) r.checked = true; }
  clearTimeout(_busAcT);
  _busAcT = setTimeout(async () => {
    const st = BUS.ac[id] || (BUS.ac[id] = { text: '', placeId: null, session: _busUuid() });
    const hits = q.trim().length < 3 ? [] : await _busGet('/bus/places/autocomplete',
      'q=' + encodeURIComponent(q.trim()) + '&session=' + encodeURIComponent(st.session)).catch(() => []);
    BUS.acHits[id] = hits;
    const el = document.getElementById(id + '-ac');
    if (el) el.innerHTML = hits.map((h, i) => `<button type="button" class="li bus-ac-item" onclick="busAcPick('${id}',${i})">${icS('pin')}<span class="li-body">${esc(h.text)}</span></button>`).join('');
  }, 250);
}
function busAcPick(id, i) {
  const h = (BUS.acHits[id] || [])[i]; if (!h) return;
  const input = document.getElementById(id); if (input) input.value = h.text;
  BUS.ac[id] = { text: h.text, placeId: h.placeId, session: _busUuid() }; // a pick ends the billing session
  BUS.acHits[id] = [];
  const el = document.getElementById(id + '-ac'); if (el) el.innerHTML = '';
}
function _busAcResolve(state, text) { return state && state.text === String(text || '').trim() ? state.placeId : null; }
function _busAcValue(id) {
  const el = document.getElementById(id), text = el ? el.value.trim() : '';
  return { address: text, placeId: _busAcResolve(BUS.ac[id], text) };
}
```

- [ ] **Step 5: Use it in the address sheet, Ends at, and Bus settings**

Replace `_busAddressPicker` and `_busReadAddress` with:

```js
function _busAddressPicker(addresses) {
  const saved = addresses.map((a, i) => `<label class="radio-row"><input type="radio" name="bus-addr" value="${a.id}" ${i === 0 ? 'checked' : ''}>
      <span>${esc(a.label || 'Saved')} · ${esc(_busSuburb(a.address))}</span></label>`).join('');
  return `${saved}<label class="radio-row"><input type="radio" name="bus-addr" value="new" ${addresses.length ? '' : 'checked'}><span>New address</span></label>
    <div class="fg">${_busAcField('bus-addr-text', '', null, 'Start typing a street address')}
      <input class="fi" id="bus-addr-label" placeholder="Label, e.g. Mum's" style="margin-top:8px"></div>`;
}
function _busReadAddress() {
  const pick = (document.querySelector('input[name="bus-addr"]:checked') || {}).value;
  if (pick && pick !== 'new') return { addressId: pick };
  const a = _busAcValue('bus-addr-text');
  if (a.address.length < 3) { toast('Enter an address'); return null; }
  return { newAddress: { label: document.getElementById('bus-addr-label').value.trim(), address: a.address, placeId: a.placeId } };
}
```

Replace `_busEndsAtField` with:

```js
function _busEndsAtField(prefix, endsAt, endsAddress, tonightOnly, endsPlaceId) {
  return `<label class="fl">Ends at</label>
    <select class="fs" id="${prefix}-ends" onchange="document.getElementById('${prefix}-ends-wrap').hidden=this.value!=='address'">
      <option value="church" ${endsAt === 'church' ? 'selected' : ''}>Church</option>
      <option value="last_drop" ${endsAt === 'last_drop' ? 'selected' : ''}>Last drop</option>
      <option value="address" ${endsAt === 'address' ? 'selected' : ''}>Address</option></select>
    <div id="${prefix}-ends-wrap" ${endsAt === 'address' ? '' : 'hidden'}>${_busAcField(prefix + '-ends-addr', endsAddress || '', endsPlaceId || null, 'Street address, suburb')}</div>
    ${tonightOnly === undefined ? '' : `<label class="cbx-row"><input type="checkbox" id="${prefix}-tonight"> Tonight only</label>`}`;
}
```

Call sites: in `busEditVehicle` use `_busEndsAtField('ve', f.endsAt, f.endsAddress, rv ? false : undefined, f.endsPlaceId)`. In `busOwnCarSheet` use `_busEndsAtField('oc', car.endsAt, car.endsAddress, undefined, car.endsPlaceId)`.

In `busSaveVehicle`, replace the line `const endsAt = val('ve-ends'), endsAddress = endsAt === 'address' ? val('ve-ends-addr').trim() : null;` with:

```js
  const endsAt = val('ve-ends'), ends = _busAcValue('ve-ends-addr');
  const endsAddress = endsAt === 'address' ? ends.address : null, endsPlaceId = endsAt === 'address' ? ends.placeId : null;
```

In the same function: the `API[...]` body becomes `tonightOnly && f ? { ...base, endsAt: f.endsAt, endsAddress: f.endsAddress, endsPlaceId: f.endsPlaceId } : { ...base, endsAt, endsAddress, endsPlaceId }`, and the tonight-only run-vehicle patch becomes `tonightOnly ? { endsAt, endsAddress, endsPlaceId, leaderIds } : { leaderIds }`.

In `busSaveOwnCar`, replace the `car:` object's ends fields with:

```js
    endsAt, endsAddress: endsAt === 'address' ? _busAcValue('oc-ends-addr').address : null,
    endsPlaceId: endsAt === 'address' ? _busAcValue('oc-ends-addr').placeId : null },
```

In `busSettings()`, replace the church input line with the following lines (the warning shows when the church has text but no pin):

```js
    <label class="fl">Church address</label>${_busAcField('bs-church', b.churchAddress || '', b.churchPlaceId || null, 'Street address, suburb')}
    ${b.churchAddress && !b.churchPlaceId ? `<div class="alert al-warn">${icS('pin')} Pick the church from the suggestions so routes can start there.</div>` : ''}
    <label class="fl">Country for address search ${helpTip("Two letters, e.g. au or nz. Leave blank to search everywhere.")}</label>
    <input class="fi" id="bs-region" maxlength="2" value="${esc(b.regionCode || '')}" placeholder="e.g. au">
```

In `busSaveSettings()`, build the patch with:

```js
  const church = _busAcValue('bs-church');
  const patch = { ministryConfig: { busMinistry: { visibility: document.getElementById('bs-vis').value,
    churchAddress: church.address, churchPlaceId: church.placeId || '',
    regionCode: document.getElementById('bs-region').value.trim().toLowerCase(), coordinatorLeaderIds } } };
```

- [ ] **Step 6: Maps links with place IDs**

Replace `_busMapsLinks` with:

```js
function _busMapsLinks(stops, church, car, churchPlaceId) {
  const enc = encodeURIComponent;
  const end = car.endsAt === 'address' && car.endsAddress ? car.endsAddress : car.endsAt === 'church' ? church : null;
  const endPid = car.endsAt === 'address' && car.endsAddress ? (car.endsPlaceId || '') : car.endsAt === 'church' ? (churchPlaceId || '') : '';
  const chunks = [];
  for (let i = 0; i < stops.length; i += 9) chunks.push(stops.slice(i, i + 9));
  return chunks.map((chunk, ci) => {
    const isLast = ci === chunks.length - 1;
    const prev = ci === 0 ? null : chunks[ci - 1][chunks[ci - 1].length - 1];
    const lastStop = chunk[chunk.length - 1];
    const toEnd = isLast && !!end;
    const origin = prev ? prev.address : church, originPid = prev ? (prev.placeId || '') : (churchPlaceId || '');
    const dest = toEnd ? end : lastStop.address, destPid = toEnd ? endPid : (lastStop.placeId || '');
    const wps = toEnd ? chunk : chunk.slice(0, -1);
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${enc(origin)}&destination=${enc(dest)}`;
    if (originPid) url += `&origin_place_id=${enc(originPid)}`;
    if (destPid) url += `&destination_place_id=${enc(destPid)}`;
    if (wps.length) url += `&waypoints=${enc(wps.map((s) => s.address).join('|'))}`;
    const ids = wps.map((s) => s.placeId || '');
    if (ids.length && ids.every(Boolean)) url += `&waypoint_place_ids=${enc(ids.join('|'))}`;
    const from = ci * 9 + 1, to = ci * 9 + chunk.length;
    return { label: chunks.length === 1 ? 'Start in Google Maps' : `Stops ${from}–${to}`, url };
  });
}
```

In `_busMyCarHtml`, change the call to `_busMapsLinks(mc.stops, mc.churchAddress, rv, mc.churchPlaceId)`.

- [ ] **Step 7: Routes tab — generate controls, lock banner, minutes, warnings, Undo toast**

Add before `_busRoutesHtml`:

```js
function _busFitCount(v) { return v.riders.filter((r) => !r.runVehicleId && !r.pinned && r.placeId).length; }
function _busLockedBy(v, nowMs, generating) {
  const until = v.run.lockUntil ? Date.parse(v.run.lockUntil) : 0;
  return !generating && v.run.lockBy && until > nowMs ? v.run.lockBy : null;
}
function _busRoutesHead() {
  const v = BUS.view;
  if (v.run.readOnly || !v.riders.length) return '';
  const lock = _busLockedBy(v, Date.now(), BUS.generating), busy = !!lock || BUS.generating;
  const fleet = new Set(v.vehicles.filter((x) => x.running && x.vehicleId).map((x) => x.id));
  const anyPlaced = v.riders.some((r) => r.runVehicleId && fleet.has(r.runVehicleId));
  const fitN = _busFitCount(v);
  const label = BUS.generating ? 'Working out routes…' : !anyPlaced ? 'Generate routes' : `Fit in ${fitN} new rider${fitN === 1 ? '' : 's'}`;
  const primary = (!anyPlaced || fitN || BUS.generating)
    ? `<button class="btn btn-primary" ${busy ? 'disabled' : ''} onclick="busGenerate('${anyPlaced ? 'fit' : 'all'}')">${icS('route')} ${label}</button>`
    : '<span style="flex:1"></span>';
  const kebab = anyPlaced ? `<button class="btn-icon" aria-label="More route options" ${busy ? 'disabled' : ''} onclick="busRoutesMenu()">${icN('kebab')}</button>` : '';
  return `${lock ? `<div class="alert al-warn bus-lock">${icS('alert')} ${esc(lock)} is generating routes…</div>` : ''}<div class="bus-gen">${primary}${kebab}</div>`;
}
function busRoutesMenu() {
  modal(`<div class="mo-title">Re-generate all routes?</div>
    <div class="card-sub" style="margin-bottom:14px">Everyone except pinned riders is re-planned. You can undo for 2 minutes.</div>
    <div class="mo-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="busGenerate('all')">Re-generate all</button></div>`);
}
async function busGenerate(mode) {
  if (BUS.generating) return;
  closeModal();
  BUS.generating = true; renderBus();
  try {
    const res = await API.post('/bus/run/generate?' + _busQs(), { mode }, 30000);
    BUS.routeMin = res.routeMin || {};
    const notes = [res.unassigned ? `${res.unassigned} still unassigned` : '', res.noAddressPin ? `${res.noAddressPin} need a map pin` : ''].filter(Boolean);
    toast(notes.length ? notes.join(' · ') : 'Routes ready', 4000);
  } catch (e) { toast(e.message || 'Could not work out routes', 4000); }
  finally { BUS.generating = false; await busRefresh(); }
}
function _busUndoBar() {
  const v = BUS.view;
  if (v.run.readOnly || !v.canCoordinate || !v.run.undoUntil || Date.parse(v.run.undoUntil) <= Date.now()) return '';
  return `<div class="bus-undo" role="status"><span>Routes updated</span><button class="btn btn-secondary btn-sm" onclick="busUndo()">Undo</button></div>`;
}
async function busUndo() { try { await _busSend('POST', '/bus/run/undo'); BUS.routeMin = {}; toast('Undone'); } catch (e) { toast(e.message); } }
```

Replace `_busRoutesHtml` with:

```js
function _busRoutesHtml() {
  const v = BUS.view;
  const unassigned = v.riders.filter((r) => !r.runVehicleId);
  const unRows = unassigned.map((r) => `<div class="route-row">
    <div class="route-main"><div class="route-name">${esc(r.name)} ${r.grade ? `<span class="chip c-neutral">Y${r.grade}</span>` : ''} ${r.pinned ? `<span style="color:var(--accent-dark)">${icS('pinned')}</span>` : ''}</div>
      <div class="route-sub">${esc(_busSuburb(r.address))} ${_busConsentChip(r)} ${r.placeId ? '' : `<span class="chip c-warn">${icS('pin')} No map pin</span>`}</div></div>
    ${v.run.readOnly ? '' : `${r.placeId ? '' : `<button class="btn btn-secondary btn-sm" onclick="busEditRider('${r.id}')">Fix address</button>`}
      <button class="btn btn-secondary btn-sm" onclick="busMoveSheet('${r.id}')">Move</button>`}
  </div>`).join('');
  const unHead = unassigned.length
    ? `<span class="card-title" style="display:flex;align-items:center;gap:6px"><span class="chip c-warn">${icS('alert')} Unassigned (${unassigned.length})</span></span>`
    : `<span class="card-title" style="display:flex;align-items:center;gap:6px;color:#065f46">${icS('check')} Unassigned (0) · All placed</span>`;
  const carCards = v.vehicles.filter((rv) => rv.running).map((rv) => {
    const riders = v.riders.filter((r) => r.runVehicleId === rv.id).sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
    const min = BUS.routeMin[rv.id];
    const warn = !riders.length ? '' : rv.eligibility.unknown ? `<span class="chip c-warn">${icS('alert')} Leader gender unknown</span>`
      : riders.some((r) => r.gender && !rv.eligibility[r.gender]) ? `<span class="chip c-warn">${icS('alert')} Gender mismatch</span>` : '';
    const rows = riders.map((r, i) => `<div class="route-row"${v.run.readOnly ? '' : ` onclick="busMoveSheet('${r.id}')"`} style="cursor:${v.run.readOnly ? 'default' : 'pointer'}">
      <div class="stop-num">${i + 1}</div>
      <div class="route-main"><div class="route-name">${esc(r.name)} ${r.pinned ? `<span style="color:var(--accent-dark)">${icS('pinned')}</span>` : ''}</div>
      <div class="route-sub">${esc(_busSuburb(r.address))} ${_busConsentChip(r)} ${r.placeId ? '' : `<span class="chip c-warn">${icS('pin')} No map pin</span>`}</div></div>
    </div>`).join('');
    return `<div class="card drop open">
      <div class="drop-head">
        <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="car-dot" style="background:${_busCarColour(rv.colourIndex)}"></span>
        <span class="card-title">${esc(rv.name)} · ${riders.length}/${rv.capacity}${min != null ? ` · ${min} min` : ''}</span>${rv.leaderNames.map((n) => `<span class="chip c-neutral">${icS('users')} ${esc(n)}</span>`).join('')}${warn}</span>
        <span class="drop-chev">${icS('chevd')}</span>
      </div>
      <div class="drop-body" style="margin-top:8px">${rows || '<div class="card-sub">No riders assigned.</div>'}</div>
    </div>`;
  }).join('');
  return `${_busRoutesHead()}<div class="card drop open">
    <div class="drop-head">${unHead}<span class="drop-chev">${icS('chevd')}</span></div>
    <div class="drop-body" style="margin-top:8px">${unRows || '<div class="card-sub">All placed — no action needed.</div>'}</div>
  </div>
  <div class="bus-routes">${carCards}</div>${_busUndoBar()}`;
}
```

In `renderBus()`, directly after `_busStartPoll();`, add the Undo-toast expiry repaint:

```js
  clearTimeout(BUS.undoTimer);
  const undoMs = BUS.view.run.undoUntil ? Date.parse(BUS.view.run.undoUntil) - Date.now() : 0;
  if (undoMs > 0) BUS.undoTimer = setTimeout(() => { if (S.page === 'bus' && !_busEditing()) renderBus(); }, undoMs + 500);
```

- [ ] **Step 8: CSS** (append inside the BUS MODULE CSS block, before `/* ── END BUS MODULE CSS ── */`)

```css
/* ── R2: generate controls, autocomplete, undo toast ── */
.bus-gen{display:flex;gap:8px;align-items:center;margin-bottom:12px}
.bus-gen .btn-primary{flex:1;min-height:44px}
.bus-lock{margin-bottom:10px}
.bus-ac-list{display:flex;flex-direction:column;margin-top:4px;border-radius:8px;overflow:hidden}
.bus-ac-list:empty{display:none}
.li.bus-ac-item{width:100%;text-align:left;font-size:13px;gap:8px;min-height:44px}
.bus-undo{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:60;display:flex;align-items:center;gap:12px;
  background:var(--navy);color:#fff;border-radius:999px;padding:6px 8px 6px 16px;box-shadow:var(--shadow);font-size:13px;max-width:calc(100% - 32px);white-space:nowrap}
@media(max-height:500px){.bus-undo{bottom:calc(56px + env(safe-area-inset-bottom))}}
@media(min-width:768px){.bus-undo{bottom:24px}}
```

- [ ] **Step 9: Bump the SW cache** — in `public/sw.js` bump `CACHE` by one (expected `ysc-v60` → `ysc-v61`).

- [ ] **Step 10: Run the tests to check they pass**

Run: `npx vitest run src/tests/spa-bus.test.ts && node scripts/check-spa-syntax.js`
Expected: PASS (the R1 maps-link test still passes: no place IDs means no `*_place_id` params).

- [ ] **Step 11: Manual smoke check (memory mode, fake routing)** — `npm run dev`, then log in as `admin`. In Youth Setup → Modules turn Bus Ministry on, set the church in Bus settings by picking a suggestion, add 2 cars and 4 riders (pick a suggestion each), then tap Generate routes. Cars should fill, minutes should show and the Undo toast should appear. Undo should clear the placements. Add a rider and check that "Fit in 1 new rider" appears. Check at 375px portrait, 667×375 landscape and 1024px.

- [ ] **Step 12: Full verification** — `npm run typecheck && npx vitest run && node scripts/check-spa-syntax.js`. Expected: green.

- [ ] **Step 13: Commit**

```bash
git add public/index.html public/sw.js src/tests/spa-bus.test.ts
git commit -m "feat(bus): SPA autocomplete, Generate / Fit in / Re-generate all, lock banner, Undo toast, Maps place IDs (R2)"
```

---

### Task 5: R3 server — detour analysis, Try +N cars, server-proxied static map

**Files:**
- Modify: `src/api/http/types.ts`, `src/api/http/express-adapter.ts` (non-JSON results), `src/services/bus-plan.ts`, `src/services/bus-logic.ts`, `src/core/entities/bus.ts`, `src/services/bus.service.ts`, `src/api/controllers/bus.controller.ts`, `src/api/http/router.ts`
- Create: `src/tests/bus.analysis.test.ts`, `src/tests/http.raw-response.test.ts`
- Test (append): `src/tests/bus-plan.test.ts`, `src/tests/bus.routes.test.ts`

**Router check (done while planning):** the router cannot return non-JSON. `express-adapter.ts` always runs `res.json(result)` on whatever the handler resolves. The minimal change is a `RawResponse` class in `types.ts` and one `instanceof` branch in the adapter. Errors stay JSON. `Cache-Control: no-store` is already set for every route. The SPA reads the image with `fetch` + bearer header and turns it into a `data:` URL, because an `<img src>` cannot send the token and the CSP allows `img-src data:` but not `blob:`.

**Interfaces:**
- Consumes (Tasks 1–3): `prepareFleet`, `routingFailed`, `NO_CHURCH`, `routingDeadline`, `decodePolyline`, `thinPolyline`, `markerLabel`, `endPlaceOf`, `leaveIso`, `capacityOf`, `stubRouting`, `recordingRouting`, `busFixture`.
- Produces:
  - `types.ts`: `class RawResponse { contentType: string; body: Uint8Array }`.
  - `bus-plan.ts`: `skipPairs(orderedPlaceIds: string[], start: string, end: string | null): ({ from: string; to: string } | null)[]`, `detours(legsSec: number[], skipSec: number[]): number[]`.
  - `bus-logic.ts`: `BUS_CAR_COLOURS: string[]` (identical to the SPA array).
  - Entities: `BusAnalysisRider`, `BusAnalysisCar`, `BusAnalysisView`, `BusExtraCarsView` (below).
  - `BusService`: `analysis(ctx): Promise<BusAnalysisView>`, `extraCars(ctx, input: { count: 1 | 2; seats: number }): Promise<BusExtraCarsView>`, `analysisMap(ctx): Promise<MapImage>`.
  - HTTP: `GET /bus/analysis`, `POST /bus/analysis/extra-cars {count, seats}`, `GET /bus/analysis/map` → image bytes (`image/png` from Google, `image/svg+xml` from the fake).

- [ ] **Step 1: Write the failing tests**

`src/tests/http.raw-response.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../api/http/express-adapter';
import { RawResponse } from '../api/http/types';
import type { AuthService } from '../services/auth.service';

describe('RawResponse', () => {
  it('sends the bytes with their content type instead of JSON', async () => {
    const app = createApp([{ method: 'GET', path: '/raw', auth: false,
      handler: async () => new RawResponse('image/png', new Uint8Array([137, 80, 78, 71])) }], {} as AuthService);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/raw`);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    } finally { server.close(); }
  });
});
```

Append to `src/tests/bus-plan.test.ts`:

```ts
import { skipPairs, detours } from '../services/bus-plan';

describe('detours', () => {
  it('skip legs: prev → next, none for the last drop when the route ends there', () => {
    expect(skipPairs(['a', 'b'], 'C', 'C')).toEqual([{ from: 'C', to: 'b' }, { from: 'a', to: 'C' }]);
    expect(skipPairs(['a', 'b'], 'C', null)).toEqual([{ from: 'C', to: 'b' }, null]);
  });
  it('detour = in + out − skip; the last drop with no end costs its inbound leg', () => {
    expect(detours([600, 300, 900], [700, 700])).toEqual([200, 500]);
    expect(detours([600, 300], [700, 0])).toEqual([200, 300]);
  });
});
```

`src/tests/bus.analysis.test.ts`

```ts
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
    await f.rider('s1'); await f.rider('s2');
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
```

Append to `src/tests/bus.routes.test.ts`:

```ts
describe('R3 routes', () => {
  it('registers analysis, extra-cars and map', async () => {
    const { services } = await buildContainer();
    const keys = buildRoutes(services).map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(expect.arrayContaining(['GET /bus/analysis', 'POST /bus/analysis/extra-cars', 'GET /bus/analysis/map']));
  });
});
```

- [ ] **Step 2: Run them to check they fail**

Run: `npx vitest run src/tests/http.raw-response.test.ts src/tests/bus-plan.test.ts src/tests/bus.analysis.test.ts src/tests/bus.routes.test.ts`
Expected: FAIL, `RawResponse` is not exported, `skipPairs` is missing, `svc.analysis is not a function`.

- [ ] **Step 3: RawResponse**

Append to `src/api/http/types.ts`:

```ts
/** A non-JSON route result (e.g. an image). The adapter sends the bytes as-is; errors stay JSON. */
export class RawResponse {
  constructor(readonly contentType: string, readonly body: Uint8Array) {}
}
```

In `src/api/http/express-adapter.ts`, change the import to `import { RawResponse, type Route, type HttpRequest } from './types';` and replace `res.json(result);` with:

```ts
        if (result instanceof RawResponse) res.type(result.contentType).send(Buffer.from(result.body));
        else res.json(result);
```

- [ ] **Step 4: Pure helpers + palette**

Append to `src/services/bus-plan.ts`:

```ts
/** For each stop in drive order, the leg that would replace it if skipped (prev → next); null for a last drop with no end. */
export function skipPairs(orderedPlaceIds: string[], start: string, end: string | null): ({ from: string; to: string } | null)[] {
  return orderedPlaceIds.map((_, i) => {
    const from = i === 0 ? start : orderedPlaceIds[i - 1]!;
    const to = i === orderedPlaceIds.length - 1 ? end : orderedPlaceIds[i + 1]!;
    return to ? { from, to } : null;
  });
}
/** Detour of stop i = t(prev→i) + t(i→next) − t(prev→next) (spec §7). legsSec = [start→s1, …, sN→end?]. */
export function detours(legsSec: number[], skipSec: number[]): number[] {
  return skipSec.map((skip, i) => Math.max(0, legsSec[i]! + (legsSec[i + 1] ?? 0) - skip));
}
```

Append to `src/services/bus-logic.ts`:

```ts
/** Same order as the SPA's BUS_CAR_COLOURS (spa-bus.test pins them equal) — the static map paints routes in these. */
export const BUS_CAR_COLOURS = ['#2563eb', '#db2777', '#059669', '#7c3aed', '#ea580c', '#0891b2', '#ca8a04', '#be123c'];
```

- [ ] **Step 5: Entities** (append to `src/core/entities/bus.ts`)

```ts
export interface BusAnalysisRider { riderId: ID; name: string; stop: number; detourMin: number; detourPct: number; flagged: boolean }
export interface BusAnalysisCar { runVehicleId: ID; name: string; colourIndex: number; routeMin: number; riders: BusAnalysisRider[] } // riders: biggest detour first
export interface BusAnalysisView {
  version: number;                 // run version this was worked out for (SPA shows "changed since" when it moves)
  detourMin: number; detourPct: number;
  cars: BusAnalysisCar[];
  unassigned: number; longestMin: number; totalMin: number;
}
export interface BusExtraCarsView {
  count: number; seats: number;
  before: { longestMin: number; totalMin: number; unassigned: number };
  after: { longestMin: number; totalMin: number; unassigned: number };
}
```

- [ ] **Step 6: Service** (`src/services/bus.service.ts`)

Add imports:

```ts
import { skipPairs, detours } from './bus-plan';                         // merge into the existing bus-plan import
import { BUS_CAR_COLOURS } from './bus-logic';                           // merge into the existing bus-logic import
import { decodePolyline, thinPolyline } from './routing/polyline';
import { markerLabel } from './routing/google-requests';
// add to the routing-provider type import: MapImage, MapMarker, MapPath, RoutePoint
// add to the entities type import: BusAnalysisView, BusExtraCarsView
```

Extend `BusService`:

```ts
  analysis(ctx: BusCtx): Promise<BusAnalysisView>;
  extraCars(ctx: BusCtx, input: unknown): Promise<BusExtraCarsView>;
  analysisMap(ctx: BusCtx): Promise<MapImage>;
```

After `GenerateIn`, add:

```ts
const ExtraCarsIn = z.object({ count: z.number().int().min(1).max(2), seats: z.number().int().min(3).max(15) });
const ANALYSIS_FAILED = "Couldn't reach Google Maps — try again in a minute.";
const MAP_MAX_POINTS = 120; // per route, keeps the Static Maps URL far under its 16k limit
```

Inside the factory, after `reorderCar`, add:

```ts
  // R3 re-solves tonight's placements (every rider fixed to their car) to get legs + polylines —
  // nothing is stored (Google terms), so this is cached per run version for the map call that follows.
  interface AnalysisSolve { key: string; cars: BusRunVehicle[]; riders: BusRunRider[]; problem: SolveProblem; result: SolveResult }
  let lastAnalysis: AnalysisSolve | null = null;
  async function analysisSolve(c: MinistryConfig, run: BusRun, signal: AbortSignal): Promise<AnalysisSolve> {
    const key = `${run.id}:${run.version}`;
    if (lastAnalysis?.key === key) return lastAnalysis;
    const b = c.busMinistry;
    if (!b.churchPlaceId) throw new BadRequestError(NO_CHURCH);
    const cars = (await bus.listRunVehicles(run.id)).filter((v) => v.running);
    const riders = (await bus.listRunRiders(run.id)).filter((r) => r.snapPlaceId && r.runVehicleId && cars.some((v) => v.id === r.runVehicleId));
    const problem: SolveProblem = { startIso: leaveIso(run.serviceDate, b.leaveTime), targetRouteMin: b.targetRouteMin, polylines: true,
      vehicles: cars.map((v) => {
        const end = endPlaceOf(v.endsAt, v.endsPlaceId, b.churchPlaceId);
        return { start: { placeId: b.churchPlaceId }, end: end ? { placeId: end } : null, capacity: riders.filter((r) => r.runVehicleId === v.id).length };
      }),
      stops: riders.map((r) => ({ point: { placeId: r.snapPlaceId! }, allowedVehicles: [cars.findIndex((v) => v.id === r.runVehicleId)], costs: [], optional: false })) };
    let result: SolveResult;
    try { result = problem.stops.length ? await routing.solve(problem, signal) : { routes: [], skipped: [] }; }
    catch (err) { throw routingFailed(err, ANALYSIS_FAILED); }
    return (lastAnalysis = { key, cars, riders, problem, result });
  }
  const minutes = (r: SolveResult, keep: (vehicle: number) => boolean = () => true) =>
    r.routes.filter((x) => keep(x.vehicle)).map((x) => Math.round(x.totalSec / 60));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
```

Add to the `svc` object:

```ts
    async analysis(ctx) {
      const c = await gate(ctx, 'bus:analysis');
      const b = c.busMinistry;
      const run = await ensureRun(ctx, c);
      const signal = routingDeadline();
      const a = await analysisSolve(c, run, signal);
      const pairs: { from: RoutePoint; to: RoutePoint }[] = [];
      const slots = a.result.routes.map((route) =>
        skipPairs(route.stops.map((s) => a.problem.stops[s]!.point.placeId), b.churchPlaceId, a.problem.vehicles[route.vehicle]!.end?.placeId ?? null)
          .map((p) => (p ? pairs.push({ from: { placeId: p.from }, to: { placeId: p.to } }) - 1 : null)));
      let secs: number[];
      try { secs = pairs.length ? await routing.matrix(pairs, signal) : []; }
      catch (err) { throw routingFailed(err, ANALYSIS_FAILED); }
      const cars = a.result.routes.map((route, k) => {
        const v = a.cars[route.vehicle]!;
        const d = detours(route.legsSec, slots[k]!.map((x) => (x == null ? 0 : secs[x]!)));
        const riders = route.stops.map((s, i) => {
          const detourMin = Math.round(d[i]! / 60), detourPct = route.totalSec ? Math.round((d[i]! / route.totalSec) * 100) : 0;
          return { riderId: a.riders[s]!.id, name: a.riders[s]!.snapName, stop: i + 1, detourMin, detourPct,
            flagged: detourMin >= b.detourMin || detourPct >= b.detourPct };
        }).sort((x, y) => y.detourMin - x.detourMin || y.detourPct - x.detourPct);
        return { runVehicleId: v.id, name: v.name, colourIndex: v.colourIndex, routeMin: Math.round(route.totalSec / 60), riders };
      });
      return { version: run.version, detourMin: b.detourMin, detourPct: b.detourPct, cars,
        unassigned: (await bus.listRunRiders(run.id)).filter((r) => !r.runVehicleId).length,
        longestMin: Math.max(0, ...cars.map((x) => x.routeMin)), totalMin: sum(cars.map((x) => x.routeMin)) };
    },
    async extraCars(ctx, input) {
      const c = await gate(ctx, 'bus:analysis');
      const v = parseIn(ExtraCarsIn, input);
      if (!c.busMinistry.churchPlaceId) throw new BadRequestError(NO_CHURCH);
      const run = await ensureRun(ctx, c);
      const signal = routingDeadline();
      const prep = await prepareFleet(c, run, 'all');
      const church = { placeId: c.busMinistry.churchPlaceId };
      // Virtual cars: two leaders each (mixed, so no gender penalty), back to church. Nothing is saved.
      const problem: SolveProblem = { ...prep.problem, vehicles: [...prep.problem.vehicles,
        ...Array.from({ length: v.count }, () => ({ start: church, end: church, capacity: capacityOf(v.seats, 2) }))] };
      let now: AnalysisSolve, extra: SolveResult;
      try {
        [now, extra] = await Promise.all([analysisSolve(c, run, signal),
          problem.stops.length ? routing.solve(problem, signal) : Promise.resolve<SolveResult>({ routes: [], skipped: [] })]);
      } catch (err) { if (err instanceof AppError) throw err; throw routingFailed(err, ANALYSIS_FAILED); }
      const fleetNow = minutes(now.result, (k) => !!now.cars[k]!.vehicleId);
      const notSent = prep.riders.filter((r) => !r.runVehicleId && (!r.snapPlaceId || r.pinned)).length;
      return { count: v.count, seats: v.seats,
        before: { longestMin: Math.max(0, ...fleetNow), totalMin: sum(fleetNow), unassigned: prep.riders.filter((r) => !r.runVehicleId).length },
        after: { longestMin: Math.max(0, ...minutes(extra)), totalMin: sum(minutes(extra)), unassigned: extra.skipped.length + notSent } };
    },
    async analysisMap(ctx) {
      const c = await gate(ctx, 'bus:analysis');
      const run = await ensureRun(ctx, c);
      const signal = routingDeadline();
      const a = await analysisSolve(c, run, signal);
      const paths: MapPath[] = [], markers: MapMarker[] = [];
      for (const route of a.result.routes) {
        const colour = BUS_CAR_COLOURS[a.cars[route.vehicle]!.colourIndex % BUS_CAR_COLOURS.length]!;
        if (route.polyline) paths.push({ colour, polyline: thinPolyline(route.polyline, MAP_MAX_POINTS) });
        route.stops.forEach((_, i) => { // stop i sits at the end of the leg into it
          const pts = decodePolyline(route.legPolylines[i] ?? '');
          const at = pts[pts.length - 1];
          if (at) markers.push({ colour, label: markerLabel(i), lat: at.lat, lng: at.lng });
        });
      }
      try { return await routing.staticMap(paths, markers, signal); }
      catch (err) { throw routingFailed(err, ANALYSIS_FAILED); }
    },
```

- [ ] **Step 7: Controller + routes**

`bus.controller.ts`: add `import { RawResponse } from '../http/types';` and:

```ts
    analysis: (r: HttpRequest) => b.analysis(ctxOf(r)),
    extraCars: (r: HttpRequest) => b.extraCars(ctxOf(r), r.body),
    analysisMap: async (r: HttpRequest) => { const img = await b.analysisMap(ctxOf(r)); return new RawResponse(img.contentType, img.bytes); },
```

`router.ts`, after the R2 lines:

```ts
    { method: 'GET',    path: '/bus/analysis',            auth: true, handler: (r) => busCtl.analysis(r) },
    { method: 'POST',   path: '/bus/analysis/extra-cars', auth: true, handler: (r) => busCtl.extraCars(r) },
    { method: 'GET',    path: '/bus/analysis/map',        auth: true, handler: (r) => busCtl.analysisMap(r) },
```

- [ ] **Step 8: Run the tests to check they pass**

Run: `npx vitest run src/tests/http.raw-response.test.ts src/tests/bus-plan.test.ts src/tests/bus.analysis.test.ts src/tests/bus.routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Full verification** — `npm run typecheck && npx vitest run && node scripts/check-spa-syntax.js`. Expected: green.

- [ ] **Step 10: Commit**

```bash
git add src/api/http/types.ts src/api/http/express-adapter.ts src/services/bus-plan.ts src/services/bus-logic.ts src/core/entities/bus.ts src/services/bus.service.ts src/api/controllers/bus.controller.ts src/api/http/router.ts src/tests/http.raw-response.test.ts src/tests/bus-plan.test.ts src/tests/bus.analysis.test.ts src/tests/bus.routes.test.ts
git commit -m "feat(bus): route analysis — detours, Try +N cars, server-proxied static map (R3)"
```

---

### Task 6: R3 SPA — Route analysis screen

**Files:**
- Modify: `public/index.html` (BUS MODULE CSS + JS), `public/sw.js`
- Test (append): `src/tests/spa-bus.test.ts`

**Interfaces:**
- Consumes (Task 5): `GET /bus/analysis` → `BusAnalysisView`, `POST /bus/analysis/extra-cars {count, seats}` → `BusExtraCarsView`, `GET /bus/analysis/map` (image bytes, needs the bearer header), `BUS_CAR_COLOURS` in `src/services/bus-logic.ts`.
- Produces: `busOpenAnalysis()`, `_busAnalysisHtml()`, `_busLoadMap()`, `busTryCars(n)`, `_busExtraLine(x)`, `_busPickTab(ids, tab, seesPast)`.

- [ ] **Step 1: Write the failing SPA tests** (append to `src/tests/spa-bus.test.ts`)

```ts
import { BUS_CAR_COLOURS } from '../services/bus-logic';

describe('R3 SPA', () => {
  it('server and SPA car colours match (the static map paints routes in them)', () => {
    const m = /const BUS_CAR_COLOURS = (\[[^\]]*\]);/.exec(loadIndexHtml())!;
    expect(JSON.parse(m[1]!.replace(/'/g, '"'))).toEqual(BUS_CAR_COLOURS);
  });
  it('_busPickTab keeps Route analysis for director/admin only', () => {
    const { _busPickTab } = loadFns(['_busPickTab']);
    expect(_busPickTab(['routes', 'mycar'], 'analysis', true)).toBe('analysis');
    expect(_busPickTab(['routes', 'mycar'], 'analysis', false)).toBe('routes');
    expect(_busPickTab(['routes', 'mycar'], 'mycar', false)).toBe('mycar');
  });
  it('_busExtraLine reads as a plain sentence with no symbols', () => {
    const { _busExtraLine } = loadFns(['_busExtraLine']);
    expect(_busExtraLine({ count: 1, seats: 8, before: { longestMin: 52, totalMin: 150, unassigned: 2 }, after: { longestMin: 38, totalMin: 160, unassigned: 0 } }))
      .toBe('+1 car, 8 seats: longest route 38 min (now 52) · unassigned 0 (now 2)');
  });
});
```

- [ ] **Step 2: Run them to check they fail**

Run: `npx vitest run src/tests/spa-bus.test.ts`
Expected: FAIL, `_busPickTab` / `_busExtraLine` are not found. The colour test already passes; it guards future edits.

- [ ] **Step 3: State + tab routing**

Add to the `const BUS = { … }` fields: `analysis: null, analysisErr: '', mapUrl: null, extra: null, extraSeats: 8, trying: false`.

Add before `renderBus`:

```js
function _busPickTab(ids, tab, seesPast) { return ids.includes(tab) || (tab === 'analysis' && seesPast) ? tab : ids[0]; }
```

In `renderBus()`:
- Move `const isAdmin = u.role === 'admin', seesPast = u.role === 'admin' || u.role === 'director';` to just above the tab check.
- Replace `if (!tabs.some((t) => t.id === BUS.tab)) BUS.tab = tabs[0].id;` with `BUS.tab = _busPickTab(tabs.map((t) => t.id), BUS.tab, seesPast);`.
- Change the body lookup to `{ roster: _busRosterHtml, cars: _busCarsHtml, routes: _busRoutesHtml, mycar: _busMyCarHtml, analysis: _busAnalysisHtml }[BUS.tab]()`.
- In `.bus-head-act`, before the Past button, add: `${seesPast ? `<button class="btn btn-secondary btn-sm" onclick="busOpenAnalysis()">${icS('route')} Analysis</button>` : ''}`.

- [ ] **Step 4: Analysis screen** (add after `_busMyCarHtml`)

```js
// ── Route analysis (R3, director/admin) ──
async function busOpenAnalysis() {
  BUS.tab = 'analysis'; BUS.analysis = null; BUS.analysisErr = ''; BUS.mapUrl = null;
  renderBus();
  try { BUS.analysis = await _busGet('/bus/analysis'); }
  catch (e) { BUS.analysisErr = e.message || 'Could not work out routes'; }
  if (S.page === 'bus' && BUS.tab === 'analysis') renderBus();
  if (BUS.analysis) _busLoadMap();
}
// <img> cannot send the bearer token and the CSP allows data: (not blob:), so fetch the bytes
// and hand the image a data: URL. The Google key never reaches the browser.
async function _busLoadMap() {
  try {
    const res = await fetch('/bus/analysis/map?' + _busQs(), { headers: API.token ? { Authorization: 'Bearer ' + API.token } : {} });
    if (!res.ok) throw new Error('Map unavailable');
    const blob = await res.blob();
    BUS.mapUrl = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob); });
  } catch { BUS.mapUrl = ''; }
  if (S.page === 'bus' && BUS.tab === 'analysis') renderBus();
}
function _busExtraLine(x) {
  return `+${x.count} car${x.count === 1 ? '' : 's'}, ${x.seats} seats: longest route ${x.after.longestMin} min (now ${x.before.longestMin}) · unassigned ${x.after.unassigned} (now ${x.before.unassigned})`;
}
async function busTryCars(count) {
  const seats = Number((document.getElementById('an-seats') || {}).value) || 8;
  BUS.extraSeats = seats; BUS.trying = true; renderBus();
  try {
    const res = await API.post('/bus/analysis/extra-cars?' + _busQs(), { count, seats }, 30000);
    BUS.extra = [res, ...(BUS.extra || [])].slice(0, 4);
  } catch (e) { toast(e.message || 'Could not try that', 4000); }
  finally { BUS.trying = false; if (S.page === 'bus' && BUS.tab === 'analysis') renderBus(); }
}
function _busAnalysisHtml() {
  if (BUS.analysisErr) return `<div class="alert al-warn">${icS('alert')} ${esc(BUS.analysisErr)}</div>`;
  const a = BUS.analysis;
  if (!a) return `<div class="card-sub">Working out routes…</div>`;
  const stale = a.version !== BUS.version
    ? `<div class="alert al-warn bus-lock">${icS('alert')} Routes have changed since this was worked out. <button class="btn btn-secondary btn-sm" onclick="busOpenAnalysis()">Refresh</button></div>` : '';
  const max = Math.max(1, ...a.cars.flatMap((c) => c.riders.map((r) => r.detourMin)));
  const cars = a.cars.map((c) => `<div class="card">
    <div class="card-title" style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span class="car-dot" style="background:${_busCarColour(c.colourIndex)}"></span>${esc(c.name)} · ${c.routeMin} min</div>
    ${c.riders.map((r) => `<div class="an-row">
      <div class="an-name">${r.stop}. ${esc(r.name)}</div>
      <div class="an-bar"><span class="${r.flagged ? 'warn' : ''}" style="width:${Math.round((r.detourMin / max) * 100)}%"></span></div>
      <div class="an-val${r.flagged ? ' warn' : ''}">${r.flagged ? icS('alert') : ''}+${r.detourMin} min</div></div>`).join('')}
  </div>`).join('');
  const map = BUS.mapUrl === null ? `<div class="an-map an-map-empty">Loading map…</div>`
    : BUS.mapUrl ? `<img class="an-map" src="${BUS.mapUrl}" alt="Map of tonight's routes">` : `<div class="an-map an-map-empty">Map unavailable</div>`;
  const tries = (BUS.extra || []).map((x) => `<div class="an-line">${esc(_busExtraLine(x))}</div>`).join('');
  return `${stale}<div class="bus-an">
    <div class="an-mapcol">${map}</div>
    <div>
      <div class="card-sub" style="margin-bottom:10px">Longest route ${a.longestMin} min · total ${a.totalMin} min${a.unassigned ? ` · ${a.unassigned} unassigned` : ''}.
        Amber = a detour of ${a.detourMin}+ min or ${a.detourPct}%+ of the car's time.</div>
      ${cars || '<div class="card-sub">No placed riders yet.</div>'}
      <div class="card"><div class="card-title">Try more cars</div>
        <div class="an-try"><label class="fl" for="an-seats" style="margin:0">Seats each</label>
          <input class="fi" id="an-seats" type="number" min="3" max="15" value="${BUS.extraSeats || 8}">
          <button class="btn btn-secondary btn-sm" ${BUS.trying ? 'disabled' : ''} onclick="busTryCars(1)">Try +1 car</button>
          <button class="btn btn-secondary btn-sm" ${BUS.trying ? 'disabled' : ''} onclick="busTryCars(2)">Try +2 cars</button></div>
        ${tries}</div>
    </div></div>`;
}
```

- [ ] **Step 5: CSS** (append inside the BUS MODULE CSS block)

```css
/* ── R3: Route analysis — map above the list on phones, beside it at ≥768px ── */
.bus-an{display:grid;gap:12px}
@media(min-width:768px){.bus-an{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.an-mapcol{position:sticky;top:12px}}
.an-map{display:block;width:100%;aspect-ratio:1/1;border-radius:var(--radius);border:1px solid var(--line);background:var(--paper-dark);object-fit:cover}
.an-map-empty{display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--ink-mid)}
@media(max-height:500px){.an-map{max-height:70vh;width:auto;max-width:100%;margin:0 auto}}
.an-row{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--paper-dark);font-size:12.5px}
.an-row:last-child{border-bottom:none}
.an-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.an-bar{height:8px;border-radius:4px;background:var(--paper-dark);overflow:hidden}
.an-bar span{display:block;height:100%;background:var(--accent)}
.an-bar span.warn{background:var(--warn)}
.an-val{display:flex;align-items:center;gap:3px;font-size:11.5px;color:var(--ink-mid);white-space:nowrap}
.an-val.warn{color:#92400e;font-weight:700}
.an-try{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.an-try .fi{width:80px}
.an-line{font-size:12.5px;padding:8px 0 0;margin-top:8px;border-top:1px solid var(--paper-dark)}
```

- [ ] **Step 6: Bump the SW cache** — `public/sw.js` `CACHE` up by one (expected `ysc-v61` → `ysc-v62`).

- [ ] **Step 7: Run the tests to check they pass**

Run: `npx vitest run src/tests/spa-bus.test.ts && node scripts/check-spa-syntax.js`
Expected: PASS.

- [ ] **Step 8: Manual smoke check (memory mode)** — log in as `director`. Generate routes, then tap Analysis. The SVG map should load, riders should be ranked with bars, and Try +1 car should add a line. At 1024px the map sits beside the list. At 667×375 landscape the map is capped at 70vh. Log in as a `grade` account and check that no Analysis button shows.

- [ ] **Step 9: Full verification** — `npm run typecheck && npx vitest run && node scripts/check-spa-syntax.js`. Expected: green.

- [ ] **Step 10: Commit**

```bash
git add public/index.html public/sw.js src/tests/spa-bus.test.ts
git commit -m "feat(bus): Route analysis screen — detour bars, Try +N cars, static map beside the list at 768px+ (R3)"
```

---

### Task 7: Docs — CLAUDE.md section + debug.md gotchas (short)

**Files:**
- Modify: `CLAUDE.md`, `debug.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: CLAUDE.md** — change the migrations note `the next migration is \`0011\` (…)` to:

```markdown
the next migration is `0013` (`0009` = `users.login_history`, `0010` = `users.login_devices`, `0011` = Bus Ministry tables, `0012` = bus consent + drop-off).
```

Then append this section at the end of the file:

```markdown
## Bus Ministry (2026-10-05) — optional module, ships OFF

Drop-home car runs after the service night. Spec: `docs/superpowers/specs/2026-10-05-bus-ministry-design.md`; plans: `…-bus-ministry-r1-core.md`, `…-bus-ministry-r2-r3-google-analysis.md`.

- **Code:** `bus.service.ts` (all rules + RBAC via `bus:*`), pure `bus-logic.ts` / `bus-plan.ts`, `IBusRepository` (in-memory + Supabase; encryption only in `supabase.bus.ts`), `/bus/*` routes, SPA block `/* ── BUS MODULE ── */`. Every `/bus` call carries `?now=YYYY-MM-DDTHH:mm` (+ `&as=<leaderId>`). Module off / `visibility:'admin'` for non-admins → 404.
- **Routing:** `src/services/routing/` — `RoutingProvider` with `GoogleRoutingProvider` (plain `fetch`, service-account JWT via `node:crypto`) and `FakeRoutingProvider` (straight-line, SVG map). Fake is used when any Google env var is missing or `PERSISTENCE=memory`; set `BUS_ROUTING=google` to test a real key in memory mode. Google gets place IDs + numbers only (tested).
- **Env (server only):** `GOOGLE_MAPS_API_KEY` (Places API (New), Routes API, Maps Static API — restrict the key to those), `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (`\n`-escaped is fine), `GOOGLE_PROJECT_ID` (Route Optimization API; the service account needs the Route Optimization Editor role). Billing account with a budget alert.
- **Data:** migrations `0011` (tables) + `0012` (consent, drop-off). No coordinates or drive times are stored — only place IDs (encrypted). Generate takes a 30 s lock (`lock_by/lock_until`, conditional update) and saves `undo_snapshot` for 2 min.
- **Deploy (spec §10):** apply `0011` + `0012` to prod **before** aliasing → set the four Google env vars in Vercel prod → deploy → `vercel alias set <url> ys-connection.vercel.app` → `curl https://ys-connection.vercel.app/bus/run` must return **401 JSON** (not HTML) → enable in Youth Setup → Modules → keep `busMinistry.visibility:'admin'` until the owner is happy, then set it to `all` in Bus settings. Set the church address in Bus settings by picking a suggestion (it needs a place ID).
```

- [ ] **Step 2: debug.md** — add this block under "Symptom router" (after the last `###` symptom section):

```markdown
### Bus Ministry

- **Generate / analysis toast "Couldn't reach Google Maps" (502 `ROUTING_FAILED`).** Vercel logs show `[routing] <what> <status>: …` (key redacted). Usual causes: an API not enabled in the Google project (Route Optimization, Places API (New), Routes API, Maps Static API), the service account missing the Route Optimization role, or a `GOOGLE_SA_PRIVATE_KEY` pasted without its `\n` line breaks (`normalisePrivateKey` handles literal `\n`, not a mangled key). Nothing was changed and the lock was released.
- **Prod quietly gives straight-line "fake" routes.** One of the four Google env vars is missing — look for `[routing] Google env not set` in the logs.
- **"X is generating routes…" banner won't go away.** The lock auto-expires 30 s after `lock_until`; the next Generate takes it over. If it persists, the clock or the version poll is stuck, not the DB.
- **Rider shows "No map pin" / Generate says "N need a map pin".** Their saved address has no place ID (added in R1 or typed without picking a suggestion). They're never sent to Google; re-pick the address from the suggestions.
- **First car / first rider missing after a solve.** Google's proto3 JSON omits zero values (`vehicleIndex`, `shipmentIndex`, skipped `index`, `"0s"`). Parsers must default to 0 — see `parseOptimizeTours`.
- **Route minutes missing on a car card.** By design — drive times are not stored (Google terms); only the device that last generated shows them. Route analysis always has them.
```

- [ ] **Step 3: Full verification** — `npm run typecheck && npx vitest run && node scripts/check-spa-syntax.js`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md debug.md
git commit -m "docs(bus): CLAUDE.md section + debug.md gotchas for Bus Ministry R2/R3"
```

---

## Rulings on spec conflicts (made while planning)

- **R1 Memory mode vs "memory mode + a real Google key" (§10).** Fake under `PERSISTENCE=memory` unless `BUS_ROUTING=google` is set.
- **R2 "9/10 · 48 min" (§6).** Drive minutes are not persisted (Google content-caching terms, so no `0013`). They come from the generating device's last result. Route analysis always computes them.
- **R3 "one computeRouteMatrix call" (§7).** This holds for ≤25 placed riders. Beyond that, calls are chunked at 25 pairs (the 625-element cap).
- **R4 "solved legs" in analysis.** Nothing is stored, so analysis re-solves tonight's placements with each rider fixed to their car. Stop numbers follow that solve, which is cached per run version for the map call.
- **R5 "streamed" map.** The bytes are proxied through `RawResponse` and buffered (no Node stream piping). The SPA turns them into a `data:` URL because `<img>` can't send the bearer token and the CSP has no `blob:`.
- **R6 Undo.** Undo restores rider placements only. Leaders added by pool auto-fill stay on their cars (visible and editable in Car setup). A car turned off since the generate gets its riders back as Unassigned.
- **R7 A rider moved to Unassigned by hand (pinned, no car)** stays Unassigned in both Generate and Fit in.
- **R8 Move when Google fails.** Falls back to R1's append-last order, so manual Move always works (§7).
- **R9 Leave time.** Nominal `serviceDate` + `leaveTime` labelled UTC, with traffic off, so the server needs no timezone.
- **R10 +N virtual cars.** Capacity is seats − 2 leaders, mixed genders (no penalty), ending at church.
- **R11 Riders with no place ID.** Never sent to Google, keep their seat (it is deducted from capacity), go after the solved stops and are counted in `noAddressPin`.
- **R12 The lock also blocks Move and Undo (409).** The spec only disables buttons, but a Move landing mid-solve would be overwritten.
