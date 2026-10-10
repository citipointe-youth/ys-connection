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
  /** One drive through `points` in the given order (first = start, last = end). `stops[i]` is where leg i ends. */
  route(points: RoutePoint[], signal: AbortSignal): Promise<{ polyline: string; stops: { lat: number; lng: number }[] }>;
}

/** Thrown by providers. The message never contains the API key or a URL. */
export class RoutingError extends Error {
  // Task 4 (owner): when Google rejects a specific placeId ("No LatLng location for placeId
  // X"), the provider parses it out and carries it here — a street-level placeId Place Details
  // also couldn't locate. Undefined for any other failure (network/5xx/timeout).
  constructor(message: string, public readonly badPlaceId?: string) { super(message); this.name = 'RoutingError'; }
}

export const GOOGLE_TIMEOUT_MS = 15_000;
/** One deadline per user action, shared by every Google call that action makes (token + solve + matrix). */
export function routingDeadline(ms = GOOGLE_TIMEOUT_MS): AbortSignal { return AbortSignal.timeout(ms); }
