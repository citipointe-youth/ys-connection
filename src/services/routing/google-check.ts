import { signJwt, describeKeyShape, type GoogleConfig } from './google-routing-provider';
import { optimizeToursBody, type ResolvedPlaces } from './google-requests';
import type { SolveProblem } from './routing-provider';

export type GoogleApiName = 'signin' | 'routeopt' | 'places' | 'routes' | 'staticmap';
export interface GoogleCheckRow { id: GoogleApiName; label: string; ok: boolean; fix?: string }

const API_TITLE: Record<GoogleApiName, string> = {
  signin: 'Sign-in', routeopt: 'Route Optimization API', places: 'Places API (New)', routes: 'Routes API', staticmap: 'Maps Static API',
};
const ROW_LABEL: Record<GoogleApiName, string> = {
  signin: 'Sign-in', routeopt: 'Route Optimization', places: 'Places', routes: 'Routes', staticmap: 'Static Maps',
};
const TIMEOUT_MS = 6_000; // sign-in + route opt run in sequence, then a parallel batch: <= 18 s < the 20 s route timeout
const PT = { latitude: -27.4698, longitude: 153.0251 }; // any fixed point; no rider data is ever sent

export function classifyGoogleError(api: GoogleApiName, status: number, bodyText: string, apiKey: string): string {
  if (api === 'staticmap' && status === 403) return 'Maps Static API is off, or the API key blocks it.';
  let reasons: string[] = [];
  let message = '';
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string; details?: { reason?: string }[] } };
    reasons = (j.error?.details ?? []).map((d) => d.reason ?? '').filter(Boolean);
    message = j.error?.message ?? '';
  } catch { /* not JSON */ }
  if (reasons.includes('SERVICE_DISABLED'))
    return `${API_TITLE[api]} is off. In Google Cloud, open APIs & Services. Turn on ${API_TITLE[api]}.`;
  if (reasons.includes('BILLING_DISABLED')) return 'Billing is off for this Google project. Turn on billing.';
  if (reasons.includes('API_KEY_INVALID') || reasons.includes('API_KEY_SERVICE_BLOCKED'))
    return 'The API key is not valid, or its restrictions block this API. Check the key and its API restrictions.';
  if (api === 'routeopt' && (reasons.includes('IAM_PERMISSION_DENIED') || status === 403))
    return 'The service account cannot use Route Optimization. In Google Cloud, give it the role Route Optimization Editor.';
  const safe = message ? message.split(apiKey).join('***').slice(0, 200) : `error ${status}`;
  return `Google reported: ${safe.replace(/\.$/, '')}.`;
}

async function attempt(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<{ status: number; text: string } | 'unreachable'> {
  try {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: res.status, text: res.ok ? '' : await res.text().catch(() => '') };
  } catch { return 'unreachable'; }
}

/** Smallest valid problem: 1 vehicle, 1 stop. Two dummy place ids are mapped to a fixed point through
 *  ResolvedPlaces (the withBadPlaceIdRetry mechanism), so the body carries lat/lng only. No rider data. */
export function buildValidateOnlyBody(nowMs: number = Date.now()) {
  const problem: SolveProblem = {
    startIso: new Date(nowMs).toISOString(), targetRouteMin: 30, polylines: false,
    vehicles: [{ start: { placeId: 'check-start' }, end: null, capacity: 1 }],
    stops: [{ point: { placeId: 'check-stop' }, allowedVehicles: null, costs: [], optional: false }],
  };
  const resolved: ResolvedPlaces = new Map([
    ['check-start', { lat: PT.latitude, lng: PT.longitude }],
    ['check-stop', { lat: PT.latitude + 0.01, lng: PT.longitude + 0.01 }],
  ]);
  return { ...optimizeToursBody(problem, resolved), solvingMode: 'VALIDATE_ONLY' as const };
}

export async function checkGoogleConnection(cfg: GoogleConfig, fetchFn: typeof fetch = (i, n) => fetch(i, n), now: () => number = Date.now): Promise<GoogleCheckRow[]> {
  const row = (id: GoogleApiName, ok: boolean, fix?: string): GoogleCheckRow => ({ id, label: ROW_LABEL[id], ok, ...(fix ? { fix } : {}) });
  const result = async (id: GoogleApiName, url: string, init: RequestInit) => {
    const r = await attempt(fetchFn, url, init);
    if (r === 'unreachable') return row(id, false, 'Google did not answer. Try again later.');
    return r.status >= 200 && r.status < 300 ? row(id, true) : row(id, false, classifyGoogleError(id, r.status, r.text, cfg.apiKey));
  };

  const validateOnlyBody = () => buildValidateOnlyBody(now());

  // 1. Sign-in
  let token: string | null = null;
  let signin: GoogleCheckRow;
  let assertion: string | null = null;
  try { assertion = signJwt(cfg.saEmail, cfg.saPrivateKey, Math.floor(now() / 1000)); }
  catch {
    console.error(`[google-check] signJwt failed — key shape: ${describeKeyShape(cfg.saPrivateKey)}`);
    signin = row('signin', false, 'The key file is not valid. Paste the whole key file again as GOOGLE_SA_JSON.');
  }
  if (assertion) {
    try {
      const res = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
      if (res.ok) { token = ((await res.json()) as { access_token: string }).access_token; signin = row('signin', true); }
      else signin = row('signin', false, 'Google did not accept the key. Make a new key with the setup command.');
    } catch { signin = row('signin', false, 'Google did not answer. Try again later.'); }
  }

  // 2. Route Optimization — VALIDATE_ONLY is not billed
  const routeopt = token
    ? await result('routeopt', `https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}:optimizeTours`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(validateOnlyBody()) })
    : row('routeopt', false, 'Fix Sign-in first.');

  // 3–5 use the API key
  const [places, routes, staticmap] = await Promise.all([
    result('places', 'https://places.googleapis.com/v1/places:autocomplete', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cfg.apiKey, 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId' },
      body: JSON.stringify({ input: 'Brisbane', includedRegionCodes: ['au'] }) }),
    result('routes', 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cfg.apiKey, 'X-Goog-FieldMask': 'originIndex,destinationIndex,condition' },
      body: JSON.stringify({ origins: [{ waypoint: { location: { latLng: PT } } }], destinations: [{ waypoint: { location: { latLng: PT } } }] }) }),
    result('staticmap', `https://maps.googleapis.com/maps/api/staticmap?size=1x1&center=${PT.latitude},${PT.longitude}&zoom=1&key=${encodeURIComponent(cfg.apiKey)}`, { method: 'GET' }),
  ]);
  return [signin!, routeopt, places, routes, staticmap];
}
