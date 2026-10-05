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
