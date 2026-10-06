import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { GoogleRoutingProvider, signJwt, normalisePrivateKey, describeKeyShape, routingFromEnv } from '../services/routing/google-routing-provider';
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
  // Prod 2026-10-06: "error:1E08010C:DECODER routines::unsupported" — the pasted env value wasn't a clean PEM.
  it.each([
    ['wrapped in quotes', `"${privateKey.replace(/\n/g, '\\n')}"`],
    ['the whole service-account JSON file', JSON.stringify({ type: 'service_account', private_key: privateKey, client_email: 'x' })],
    ['newlines flattened to spaces', privateKey.replace(/\n/g, ' ')],
    ['CRLF line endings', privateKey.replace(/\n/g, '\r\n')],
    ['double-escaped \\\\n', privateKey.replace(/\n/g, '\\\\n')],
  ])('signs with a private key pasted as %s', (_, pasted) => {
    expect(() => signJwt(cfg.saEmail, normalisePrivateKey(pasted), 1_700_000_000)).not.toThrow();
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
  // Task 7: a signJwt failure must log enough to diagnose a bad key — but never the key itself.
  it('a signJwt failure logs key shape, never key material', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badKey = 'not-a-real-key-SECRETVALUE123';
    const badCfg = { ...cfg, saPrivateKey: badKey };
    const g = new GoogleRoutingProvider(badCfg, stubFetch({}).fn);
    await expect(g.solve(problem, sig())).rejects.toThrow(/not a readable private key/);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain(badKey);
    expect(logged).not.toContain('SECRETVALUE123');
    expect(logged).toMatch(/hasBegin=false/);
    expect(logged).toMatch(/length=\d+/);
    err.mockRestore();
  });
  it('describeKeyShape never echoes the key content', () => {
    expect(describeKeyShape('-----BEGIN PRIVATE KEY-----\nSECRETBASE64\n-----END PRIVATE KEY-----\n'))
      .toBe('length=67 hasBegin=true hasEnd=true base64BodyLen=12 startsWithBrace=false');
    expect(describeKeyShape('{"private_key":"x"}')).toMatch(/startsWithBrace=true/);
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
  // I4: outside memory mode, the fake fallback must not offer "Testville" autocomplete
  // suggestions — they'd get saved as a real address once the real key is later set.
  it('I4: the prod fallback (missing env, not memory mode) suggests nothing; memory/test mode still does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig2 = new AbortController().signal;
    expect(await routingFromEnv({ PERSISTENCE: 'supabase' }).autocomplete('24 Wynnum Rd', 's', '', sig2)).toEqual([]);
    expect(await routingFromEnv({ PERSISTENCE: 'memory' }).autocomplete('24 Wynnum Rd', 's', '', sig2)).not.toEqual([]);
    warn.mockRestore();
  });
});
