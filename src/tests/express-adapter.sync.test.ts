// Lane E1: the sync-token gate for `sync: true` routes (spec 2026-10-12-elvanto-link-app-design.md §10.1).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Route, HttpRequest } from '../api/http/types';
import type { AuthService } from '../services/auth.service';
import type { Actor } from '../core/entities/user';
import { createApp, UNTIMED_ROUTES } from '../api/http/express-adapter';
import { makeSyncController } from '../api/controllers/sync.controller';
import { LINK_CONTRACT_VERSION } from '../core/link-contract';

const j = async (r: Response): Promise<any> => r.json();

const timed = vi.hoisted(() => ({ labels: [] as number[] }));
vi.mock('../utils/timeout', async (orig) => {
  const m = await orig<typeof import('../utils/timeout')>();
  return { ...m, withTimeout: <T>(p: Promise<T>, ms: number) => { timed.labels.push(ms); return m.withTimeout(p, ms); } };
});


const TOKEN = 'Tk_' + 'x9'.repeat(20); // 43 chars, mixed case
const SECRET_BODY = 'note-body-should-never-be-logged';

const seen: { sync: HttpRequest[]; session: HttpRequest[] } = { sync: [], session: [] };
// F4: the real controller rows for /sync/alerts, with a spy run.
const alertRun = { run: vi.fn(async (_now: Date, which: string[]) => Object.fromEntries(which.map((k) => [k, { leaders: 0, sent: 0, failed: 0, skipped: 'module-off' }]))) };
const syncCtl = makeSyncController({ sync: {} as never, reconcile: {} as never, nightSummary: {} as never, alerts: alertRun as never });
const routes: Route[] = [
  { method: 'POST', path: '/sync/alerts', auth: false, sync: true, handler: (r) => syncCtl.alerts(r) },
  { method: 'GET', path: '/sync/alerts', auth: false, cron: true, handler: () => syncCtl.alertsCron() },
  { method: 'POST', path: '/sync/ping', auth: false, sync: true,
    handler: async (r) => { seen.sync.push(r); return { ok: true, ctxNull: r.ctx === null }; } },
  { method: 'POST', path: '/sync/boom', auth: false, sync: true,
    handler: async () => { throw new Error('boom'); } },
  { method: 'GET', path: '/s', auth: true,
    handler: async (r) => { seen.session.push(r); return { ok: true }; } },
];

const mustChange: Actor = { id: 'u1', role: 'admin', email: 'a', displayName: 'A', mustChangePassword: true } as unknown as Actor;
const plain: Actor = { id: 'u2', role: 'admin', email: 'b', displayName: 'B' } as unknown as Actor;
const resolveToken = vi.fn(async (t: string) => (t === 'must' ? mustChange : t === 'ok' ? plain : null));
const auth = { resolveToken } as unknown as AuthService;

let server: Server;
let base = '';
const saved = process.env['LINK_SYNC_TOKEN'];
const savedCron = process.env['CRON_SECRET'];

beforeAll(() => {
  server = createApp(routes, auth).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  if (saved === undefined) delete process.env['LINK_SYNC_TOKEN']; else process.env['LINK_SYNC_TOKEN'] = saved;
  if (savedCron === undefined) delete process.env['CRON_SECRET']; else process.env['CRON_SECRET'] = savedCron;
});
afterEach(() => { vi.restoreAllMocks(); resolveToken.mockClear(); alertRun.run.mockClear(); seen.sync.length = 0; seen.session.length = 0; });

describe('SY-06: a wrong /sync token leaves an Error log row', () => {
  it('logs code and route only, never the token; session 401s and good tokens log nothing', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const record = vi.fn(async () => {});
    const srv = createApp(routes, auth, undefined, { record } as never).listen(0);
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const guess = 'Guess_' + 'y7'.repeat(20);
    try {
      expect((await fetch(`${url}/sync/ping`, { method: 'POST', headers: { authorization: `Bearer ${guess}` } })).status).toBe(401);
      expect(record.mock.calls).toEqual([[{ category: 'link', code: 'sync-bad-token', route: 'POST /sync/ping', status: 401, role: 'console' }]]);
      expect(JSON.stringify(record.mock.calls)).not.toContain(guess);
      record.mockClear();
      expect((await fetch(`${url}/sync/ping`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
      expect((await fetch(`${url}/s`)).status).toBe(401);
      expect(record).not.toHaveBeenCalled();
    } finally { srv.close(); }
  });
});

describe('security review 2026-11-04: a throttled login leaves an Error log row', () => {
  it('logs code and route only, and the 429 does not wait for the write', async () => {
    const record = vi.fn(() => new Promise<void>(() => {})); // never settles: the reply must not wait for it
    const login = vi.fn(async () => ({ ok: true }));
    const srv = createApp([{ method: 'POST', path: '/auth/login', auth: false, handler: login }], auth, undefined, { record } as never).listen(0);
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/auth/login`;
    const email = 'sample.dummyton.throttle@example.test';
    const attempt = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    try {
      for (let i = 0; i < 30; i++) expect((await attempt()).status).toBe(200);
      expect(record).not.toHaveBeenCalled();
      expect((await attempt()).status).toBe(429);
      expect(login).toHaveBeenCalledTimes(30);
      expect(record.mock.calls).toEqual([[{ category: 'server', code: 'login-throttled', route: 'POST /auth/login', status: 429 }]]);
    } finally { srv.close(); }
  });
});

const sync = (authz: string | null, path = '/sync/ping') => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(authz === null ? {} : { authorization: authz }) },
  body: JSON.stringify({ note: SECRET_BODY }),
});

describe('sync routes: token gate', () => {
  it('token unset → 503 LINK_OFF; handler never runs', async () => {
    delete process.env['LINK_SYNC_TOKEN'];
    const r = await sync(`Bearer ${TOKEN}`);
    expect(r.status).toBe(503);
    expect((await j(r)).code).toBe('LINK_OFF');
    expect(seen.sync).toHaveLength(0);
  });

  it('a 31-character token counts as unset → 503', async () => {
    process.env['LINK_SYNC_TOKEN'] = 'a'.repeat(31);
    const r = await sync(`Bearer ${'a'.repeat(31)}`);
    expect(r.status).toBe(503);
    expect((await j(r)).code).toBe('LINK_OFF');
  });

  it('the exact header → handler runs with ctx === null, resolveContext never called', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const r = await sync(`Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(await j(r)).toEqual({ ok: true, ctxNull: true });
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it('the token is read per request (a change in env applies at once)', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    expect((await sync(`Bearer ${TOKEN}`)).status).toBe(200);
    process.env['LINK_SYNC_TOKEN'] = TOKEN + 'Z';
    expect((await sync(`Bearer ${TOKEN}`)).status).toBe(401);
    expect((await sync(`Bearer ${TOKEN}Z`)).status).toBe(200);
  });

  it.each([
    ['wrong token', `Bearer ${'y'.repeat(43)}`],
    ['lower-cased token', `Bearer ${TOKEN.toLowerCase()}`],
    ['lower-case scheme', `bearer ${TOKEN}`],
    ['two spaces', `Bearer  ${TOKEN}`],
    // (HTTP itself trims trailing header whitespace, so a trailing space never reaches the server.)
    ['extra characters', `Bearer ${TOKEN}x`],
    ['token twice', `Bearer ${TOKEN} ${TOKEN}`],
    ['no scheme', TOKEN],
    ['a session token', 'Bearer ok'],
  ])('%s → 401 UNAUTHORIZED JSON', async (_n, h) => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const r = await sync(h);
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toMatch(/json/);
    expect((await j(r)).code).toBe('UNAUTHORIZED');
    expect(seen.sync).toHaveLength(0);
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it('no header → 401', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const r = await sync(null);
    expect(r.status).toBe(401);
    expect((await j(r)).code).toBe('UNAUTHORIZED');
  });

  it('is not blocked by must-change-password (no session is resolved at all)', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    // A session route with a must-change actor is blocked …
    const s = await fetch(base + '/s', { headers: { authorization: 'Bearer must' } });
    expect(s.status).toBe(403);
    // … but a sync route never looks at the session.
    expect((await sync(`Bearer ${TOKEN}`)).status).toBe(200);
  });

  it('keeps the 20 s guard (sync routes are timed)', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    timed.labels.length = 0;
    await sync(`Bearer ${TOKEN}`);
    expect(timed.labels).toEqual([20_000]);
    expect([...UNTIMED_ROUTES].filter((r) => r.includes('/sync'))).toEqual(['POST /sync/alerts', 'GET /sync/alerts']);
  });

  it('no dead route in UNTIMED_ROUTES: POST /audits is gone (final review M1)', () => {
    expect(UNTIMED_ROUTES.has('POST /audits')).toBe(false);
  });

  it('ultra #3: the admin manual audit upload (its replacement) is untimed', () => {
    expect(UNTIMED_ROUTES.has('POST /audits/sources/:source')).toBe(true);
  });

  it('logs neither the header nor the body (pass, fail and handler error)', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await sync(`Bearer ${TOKEN}`);
    await sync(`Bearer wrong`);
    await sync(`Bearer ${TOKEN}`, '/sync/boom');
    delete process.env['LINK_SYNC_TOKEN'];
    await sync(`Bearer ${TOKEN}`);
    const out = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(SECRET_BODY);
  });
});

describe('F4: /sync/alerts (console trigger + cron catch-up)', () => {
  const CRON = 'Cr_' + 'q8'.repeat(20);
  const BODY = { contractVersion: LINK_CONTRACT_VERSION, consoleId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a' };
  const post = (authz: string | null, url = base) => fetch(`${url}/sync/alerts`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(authz === null ? {} : { authorization: authz }) }, body: JSON.stringify(BODY) });
  const get = (authz: string | null, url = base) => fetch(`${url}/sync/alerts`, { headers: authz === null ? {} : { authorization: authz } });

  it('POST /sync/alerts without link token 401', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    expect((await post(null)).status).toBe(401);
    expect((await post(`Bearer ${CRON}`)).status).toBe(401);
    expect(alertRun.run).not.toHaveBeenCalled();
  });

  it('POST /sync/alerts with LINK_SYNC_TOKEN unset 503', async () => {
    delete process.env['LINK_SYNC_TOKEN'];
    const r = await post(`Bearer ${TOKEN}`);
    expect(r.status).toBe(503);
    expect((await j(r)).code).toBe('LINK_OFF');
    expect(alertRun.run).not.toHaveBeenCalled();
  });

  it('POST /sync/alerts with the token runs both kinds', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const r = await post(`Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(Object.keys(await j(r))).toEqual(['bday', 'lgrem']);
    expect(alertRun.run.mock.calls[0]![1]).toEqual(['bday', 'lgrem']);
  });

  it('POST /sync/alerts checks the body (contractVersion, consoleId)', async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const r = await fetch(`${base}/sync/alerts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: '{}' });
    expect(r.status).toBe(400);
    expect(alertRun.run).not.toHaveBeenCalled();
  });

  it('GET /sync/alerts with CRON_SECRET unset 503 and runs nothing', async () => {
    delete process.env['CRON_SECRET'];
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    for (const h of [`Bearer ${CRON}`, `Bearer ${TOKEN}`, null]) expect((await get(h)).status).toBe(503);
    process.env['CRON_SECRET'] = 'short';
    expect((await get('Bearer short')).status).toBe(503);
    expect(alertRun.run).not.toHaveBeenCalled();
  });

  it('GET /sync/alerts bad bearer 401 logs cron-bad-token', async () => {
    process.env['CRON_SECRET'] = CRON;
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    const record = vi.fn(async () => {});
    const srv = createApp(routes, auth, undefined, { record } as never).listen(0);
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      expect((await get(`Bearer ${TOKEN}`, url)).status).toBe(401); // the link token is not the cron secret
      expect((await get(null, url)).status).toBe(401);
      expect(record.mock.calls).toEqual([
        [{ category: 'server', code: 'cron-bad-token', route: 'GET /sync/alerts', status: 401, role: 'cron' }],
        [{ category: 'server', code: 'cron-bad-token', route: 'GET /sync/alerts', status: 401, role: 'cron' }],
      ]);
      expect(JSON.stringify(record.mock.calls)).not.toContain(TOKEN);
      expect(alertRun.run).not.toHaveBeenCalled();
    } finally { srv.close(); }
  });

  it('GET /sync/alerts good bearer runs bday only', async () => {
    process.env['CRON_SECRET'] = CRON;
    delete process.env['LINK_SYNC_TOKEN']; // the cron does not need the link
    const r = await get(`Bearer ${CRON}`);
    expect(r.status).toBe(200);
    expect(await j(r)).toEqual({ bday: { leaders: 0, sent: 0, failed: 0, skipped: 'module-off' } });
    expect(alertRun.run.mock.calls.map((c) => c[1])).toEqual([['bday']]);
  });

  it('both routes are in UNTIMED_ROUTES', async () => {
    expect(UNTIMED_ROUTES.has('POST /sync/alerts')).toBe(true);
    expect(UNTIMED_ROUTES.has('GET /sync/alerts')).toBe(true);
    process.env['CRON_SECRET'] = CRON;
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    timed.labels.length = 0;
    await get(`Bearer ${CRON}`);
    await post(`Bearer ${TOKEN}`);
    expect(timed.labels).toEqual([]);
  });
});
