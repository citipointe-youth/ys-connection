// Lane E1: the sync-token gate for `sync: true` routes (spec 2026-10-12-elvanto-link-app-design.md §10.1).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Route, HttpRequest } from '../api/http/types';
import type { AuthService } from '../services/auth.service';
import type { Actor } from '../core/entities/user';
import { createApp, UNTIMED_ROUTES } from '../api/http/express-adapter';

const j = async (r: Response): Promise<any> => r.json();

const timed = vi.hoisted(() => ({ labels: [] as number[] }));
vi.mock('../utils/timeout', async (orig) => {
  const m = await orig<typeof import('../utils/timeout')>();
  return { ...m, withTimeout: <T>(p: Promise<T>, ms: number) => { timed.labels.push(ms); return m.withTimeout(p, ms); } };
});


const TOKEN = 'Tk_' + 'x9'.repeat(20); // 43 chars, mixed case
const SECRET_BODY = 'note-body-should-never-be-logged';

const seen: { sync: HttpRequest[]; session: HttpRequest[] } = { sync: [], session: [] };
const routes: Route[] = [
  { method: 'POST', path: '/sync/ping', auth: false, sync: true,
    handler: async (r) => { seen.sync.push(r); return { ok: true, ctxNull: r.ctx === null }; } },
  { method: 'POST', path: '/sync/boom', auth: false, sync: true,
    handler: async () => { throw new Error('boom'); } },
  { method: 'GET', path: '/s', auth: true,
    handler: async (r) => { seen.session.push(r); return { headers: r.headers ?? null }; } },
];

const mustChange: Actor = { id: 'u1', role: 'admin', email: 'a', displayName: 'A', mustChangePassword: true } as unknown as Actor;
const plain: Actor = { id: 'u2', role: 'admin', email: 'b', displayName: 'B' } as unknown as Actor;
const resolveToken = vi.fn(async (t: string) => (t === 'must' ? mustChange : t === 'ok' ? plain : null));
const auth = { resolveToken } as unknown as AuthService;

let server: Server;
let base = '';
const saved = process.env['LINK_SYNC_TOKEN'];

beforeAll(() => {
  server = createApp(routes, auth).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  if (saved === undefined) delete process.env['LINK_SYNC_TOKEN']; else process.env['LINK_SYNC_TOKEN'] = saved;
});
afterEach(() => { vi.restoreAllMocks(); resolveToken.mockClear(); seen.sync.length = 0; seen.session.length = 0; });

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
    expect([...UNTIMED_ROUTES].some((r) => r.includes('/sync'))).toBe(false);
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

describe('session routes: device headers', () => {
  it('x-device-id and x-device-label reach req.headers', async () => {
    const r = await fetch(base + '/s', { headers: { authorization: 'Bearer ok', 'x-device-id': 'dev-1', 'x-device-label': 'iPhone · Safari' } });
    expect(r.status).toBe(200);
    expect((await j(r)).headers).toEqual({ deviceId: 'dev-1', deviceLabel: 'iPhone · Safari' });
  });

  it('missing device headers → undefined fields', async () => {
    const r = await fetch(base + '/s', { headers: { authorization: 'Bearer ok' } });
    expect((await j(r)).headers).toEqual({});
  });
});
