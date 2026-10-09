import { createSign } from 'node:crypto';
import { RoutingError, type RoutingProvider, type SolveProblem, type SolveResult, type PlaceSuggestion, type RoutePoint,
  type MapPath, type MapMarker, type MapImage } from './routing-provider';
import { optimizeToursBody, parseOptimizeTours, autocompleteBody, parseAutocomplete, routeMatrixBody, parseRouteMatrix,
  staticMapUrl, MATRIX_MAX_PAIRS, type ResolvedPlaces } from './google-requests';
import { FakeRoutingProvider } from './fake-routing-provider';
import { googleConfigFromEnv } from './google-config';

export interface GoogleConfig { apiKey: string; saEmail: string; saPrivateKey: string; projectId: string }

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
// Google's exact wording, e.g.: No LatLng location for placeId "EiZTdCBBbmRyZXdz..." available
const NO_LATLNG_RE = /No LatLng location for placeId "([^"]+)"/;
// Task 4 (owner): at most this many distinct bad placeIds get a Place Details lookup + retry
// per solve()/matrix() call, all inside the caller's existing deadline.
const MAX_BAD_PLACE_RETRIES = 5;

/**
 * Rebuilds a clean PEM from however the key was pasted into the Vercel dashboard: literal "\n"
 * (single or double escaped), CRLF, newlines flattened to spaces, wrapping quotes, or the whole
 * service-account JSON file. A mangled PEM fails in createSign with "DECODER routines::unsupported".
 */
export function normalisePrivateKey(k: string): string {
  let s = k.trim();
  if (s.startsWith('{')) { try { s = String(JSON.parse(s).private_key ?? s); } catch { /* not JSON — use as-is */ } }
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(s);
  if (!m) {
    // Just the base64 body (BEGIN/END lines left off) — a service-account key is PKCS#8 "PRIVATE KEY".
    const bare = s.replace(/\\+[rn]/g, '').replace(/[\s"]/g, '');
    if (/^[A-Za-z0-9+/]{100,}={0,2}$/.test(bare)) return normalisePrivateKey(`-----BEGIN PRIVATE KEY-----${bare}-----END PRIVATE KEY-----`);
    return s.replace(/\\n/g, '\n').trim();
  }
  const body = m[2]!.replace(/\\+[rn]/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  return [`-----BEGIN ${m[1]}-----`, ...(body.match(/.{1,64}/g) ?? []), `-----END ${m[1]}-----`].join('\n');
}

/** Shape-only description of a private key for error logs — NEVER any of the key's own characters. */
export function describeKeyShape(k: string): string {
  const hasBegin = k.includes('BEGIN PRIVATE KEY'), hasEnd = k.includes('END PRIVATE KEY');
  const m = /-----BEGIN [A-Z ]+-----([\s\S]*?)-----END [A-Z ]+-----/.exec(k);
  const base64BodyLen = (m ? m[1]! : k).replace(/[\r\n\s]/g, '').length;
  return `length=${k.length} hasBegin=${hasBegin} hasEnd=${hasEnd} base64BodyLen=${base64BodyLen} startsWithBrace=${k.trim().startsWith('{')}`;
}

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
      // Task 4: pull the placeId out of the FULL body (not the 300-char log slice, which can
      // truncate the (long, base64) placeId before its closing quote) — never log the address
      // itself, just the opaque id, which withBadPlaceIdRetry() may resolve via Place Details.
      // Google's error body is itself JSON, so the message's own quotes around the placeId
      // arrive backslash-escaped on the wire (`\"A\"`) — unescape before matching.
      throw new RoutingError(`Google ${what} failed (${res.status})`, NO_LATLNG_RE.exec(body.replace(/\\"/g, '"'))?.[1]);
    }
    return res;
  }

  /** Task 4: Place Details (New) gives a street-level placeId's midpoint — the fallback location
   *  when Route Optimization/Route Matrix reject that placeId outright. Returns null (never
   *  throws) on any failure, so the caller just re-throws the original RoutingError. */
  private async placeLocation(placeId: string, signal: AbortSignal): Promise<{ lat: number; lng: number } | null> {
    try {
      const res = await this.call(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, { method: 'GET',
        headers: { 'X-Goog-Api-Key': this.cfg.apiKey, 'X-Goog-FieldMask': 'location' } }, signal, 'place details');
      const j = (await res.json()) as { location?: { latitude: number; longitude: number } };
      return j.location ? { lat: j.location.latitude, lng: j.location.longitude } : null;
    } catch { return null; }
  }

  /** Retries `attempt` after swapping a Google-rejected placeId for its Place Details lat/lng
   *  (via the `resolved` map `attempt` must read when building its request body) — up to
   *  MAX_BAD_PLACE_RETRIES distinct bad places. `resolved` is caller-scoped and never persisted. */
  private async withBadPlaceIdRetry<T>(signal: AbortSignal, resolved: ResolvedPlaces, attempt: () => Promise<T>): Promise<T> {
    for (;;) {
      try { return await attempt(); }
      catch (err) {
        if (!(err instanceof RoutingError) || !err.badPlaceId || resolved.has(err.badPlaceId) || resolved.size >= MAX_BAD_PLACE_RETRIES) throw err;
        const loc = await this.placeLocation(err.badPlaceId, signal);
        if (!loc) throw err; // Place Details couldn't locate it either — let the caller map it to a friendly name
        resolved.set(err.badPlaceId, loc);
      }
    }
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    let assertion: string;
    try { assertion = signJwt(this.cfg.saEmail, this.cfg.saPrivateKey, Math.floor(this.now() / 1000)); }
    catch {
      console.error(`[routing] signJwt failed — key shape: ${describeKeyShape(this.cfg.saPrivateKey)}`);
      throw new RoutingError('GOOGLE_SA_PRIVATE_KEY is not a readable private key — paste the private_key value from the service-account JSON');
    }
    const res = await this.call(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() }, signal, 'sign-in');
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: this.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async solve(p: SolveProblem, signal: AbortSignal): Promise<SolveResult> {
    // Google reads an EMPTY allowedVehicleIndices as "any vehicle" — so a stop with no allowed car
    // (a girl when no car has a female leader) is left out of the request and reported skipped.
    const keep = p.stops.map((_, i) => i).filter((i) => p.stops[i]!.allowedVehicles?.length !== 0);
    if (keep.length < p.stops.length) {
      const sub = keep.length ? await this.solve({ ...p, stops: keep.map((i) => p.stops[i]!) }, signal) : { routes: [], skipped: [] };
      return { routes: sub.routes.map((r) => ({ ...r, stops: r.stops.map((s) => keep[s]!) })),
        skipped: [...sub.skipped.map((s) => keep[s]!), ...p.stops.map((_, i) => i).filter((i) => !keep.includes(i))] };
    }
    const token = await this.accessToken(signal);
    const resolved: ResolvedPlaces = new Map();
    return this.withBadPlaceIdRetry(signal, resolved, async () => {
      const res = await this.call(`https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(this.cfg.projectId)}:optimizeTours`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(optimizeToursBody(p, resolved)) },
        signal, 'route optimisation');
      return parseOptimizeTours(await res.json(), p);
    });
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
    // Task 4: one `resolved` map shared across every chunk of this call — a bad placeId that
    // shows up in two chunks (likely, since cars often share an origin) only costs one Place
    // Details lookup, and the MAX_BAD_PLACE_RETRIES budget is shared too, not per-chunk.
    const resolved: ResolvedPlaces = new Map();
    for (let i = 0; i < pairs.length; i += MATRIX_MAX_PAIRS) {
      const chunk = pairs.slice(i, i + MATRIX_MAX_PAIRS);
      const secs = await this.withBadPlaceIdRetry(signal, resolved, async () => {
        const res = await this.call('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.cfg.apiKey,
            'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition' },
          body: JSON.stringify(routeMatrixBody(chunk, resolved)) }, signal, 'travel times');
        return parseRouteMatrix(await res.json(), chunk);
      });
      out.push(...secs);
    }
    return out;
  }

  async staticMap(paths: MapPath[], markers: MapMarker[], signal: AbortSignal): Promise<MapImage> {
    const res = await this.call(staticMapUrl(paths, markers, this.cfg.apiKey), { method: 'GET' }, signal, 'map');
    return { contentType: res.headers.get('content-type') ?? 'image/png', bytes: new Uint8Array(await res.arrayBuffer()) };
  }
}

/**
 * True exactly when routingFromEnv() just below would return the real Google provider: all
 * four Google env vars are set, and (PERSISTENCE=memory implies BUS_ROUTING=google — the
 * owner's "memory mode + a real key" check, spec §10). The one other place that needs this
 * without constructing a provider (settings.service.ts, saving busMinistry.churchPlaceId) for
 * I4's "reject a fake: place ID once Google is live" check.
 */
export function googleRoutingEnabled(e: NodeJS.ProcessEnv = process.env): boolean {
  const memory = (e['PERSISTENCE'] ?? 'memory') === 'memory';
  return !!googleConfigFromEnv(e) && (!memory || e['BUS_ROUTING'] === 'google');
}

export function routingFromEnv(e: NodeJS.ProcessEnv = process.env): RoutingProvider {
  const memory = (e['PERSISTENCE'] ?? 'memory') === 'memory';
  const cfg = googleRoutingEnabled(e) ? googleConfigFromEnv(e) : null;
  if (!cfg) {
    if (!memory) {
      console.warn('[routing] Google env not set — Bus Ministry uses straight-line fake routes');
      return new FakeRoutingProvider({ suggest: false });
    }
    return new FakeRoutingProvider();
  }
  return new GoogleRoutingProvider(cfg);
}
