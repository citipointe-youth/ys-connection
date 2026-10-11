// Lane E2: /link and /sync routes, the route checklist, and a live memory-mode server
// (spec 2026-10-12-elvanto-link-app-design.md §10.1, §10.2).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildContainer, type Container } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { ClaimResponse } from '../core/link-contract';
import { brisbaneToday } from '../services/link-rules';

const root = join(__dirname, '..', '..');
const fixture = (n: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'elvanto-link', n), 'utf8'));
const j = async (r: Response): Promise<any> => r.json();

const SPEC_ROUTES = [
  'POST /sync/claim', 'POST /sync/result', 'POST /sync/push/:kind',
  'GET /link/status', 'GET /link/checkin', 'POST /link/actions', 'GET /link/actions', 'DELETE /link/actions/:id',
  'POST /link/batch', 'GET /link/lifegroups', 'GET /link/flows',
  'GET /link/admin/roster', 'POST /link/admin/roster/:personId', 'GET /link/admin/shadow-check', 'GET /link/admin/log',
];

describe('link + sync route table', () => {
  it('equals spec §10.1; /link is session, /sync is sync-token only', async () => {
    const { services } = await buildContainer();
    const routes = buildRoutes(services).filter((r) => /^\/(link|sync)(\/|$)/.test(r.path));
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([...SPEC_ROUTES].sort());
    for (const r of routes) {
      if (r.path.startsWith('/link')) { expect(r.auth).toBe(true); expect(r.sync).toBeUndefined(); }
      else { expect(r.sync).toBe(true); expect(r.auth).toBe(false); }
    }
  });
  it('vercel.json sends /link and /sync to the function', () => {
    const src = new RegExp(JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).routes[0].src);
    for (const p of ['/link/status', '/sync/claim', '/link/actions/abc', '/sync/push/roster']) expect(src.test(p)).toBe(true);
  });
  it('sw.js API_RE bypasses the cache for /link and /sync', () => {
    const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
    const re = new Function(`${sw.match(/const API_RE = .*;/)![0]} return API_RE;`)() as RegExp;
    expect(re.test('/link/x')).toBe(true);
    expect(re.test('/sync/x')).toBe(true);
  });
});

describe('link + sync live (memory)', () => {
  const TOKEN = 'Sy' + 'n4'.repeat(20);
  const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW';
  const saved = { t: process.env['LINK_SYNC_TOKEN'], c: process.env['SETUP_CODE'] };
  let server: Server; let base = ''; let c: Container; let admin = '';
  const svcTime = '57000000-0000-4000-8000-000000000001';
  const svcId = '5e000000-0000-4000-8000-000000000001';
  const alex = '9e000000-0000-4000-8000-000000000001';
  const jamie = '9e000000-0000-4000-8000-000000000003';

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const sync = (path: string, body: unknown) => call('POST', path, body, { authorization: `Bearer ${TOKEN}` });
  const asAdmin = (method: string, path: string, body?: unknown) =>
    call(method, path, body, { authorization: `Bearer ${admin}`, 'x-device-id': 'd1', 'x-device-label': 'Test phone' });

  beforeAll(async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    process.env['SETUP_CODE'] = CODE;
    c = await buildContainer();
    server = createApp(buildRoutes(c.services), c.services.auth).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = (await c.services.setup.createFirstAdmin({ code: CODE, displayName: 'Pat', password: 'longenough' })).token;
    const s = await c.repos.settings.getSettings();
    await c.repos.settings.updateSettings({ ministryConfig: { ...s.ministryConfig,
      modules: { ...s.ministryConfig.modules, newYouthForms: 'shadow' } } });
  });
  afterAll(() => {
    server.close();
    for (const [k, v] of [['LINK_SYNC_TOKEN', saved.t], ['SETUP_CODE', saved.c]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('claim-request.json with the right token → 200, parses with ClaimResponse', async () => {
    const r = await sync('/sync/claim', fixture('claim-request.json'));
    expect(r.status).toBe(200);
    expect(ClaimResponse.safeParse(await j(r)).success).toBe(true);
  });
  it('a lower-cased token → 401 JSON', async () => {
    const r = await call('POST', '/sync/claim', fixture('claim-request.json'), { authorization: `Bearer ${TOKEN.toLowerCase()}` });
    expect(r.status).toBe(401);
    expect((await j(r)).code).toBe('UNAUTHORIZED');
  });
  it('a session token on /sync → 401', async () => {
    expect((await call('POST', '/sync/claim', fixture('claim-request.json'), { authorization: `Bearer ${admin}` })).status).toBe(401);
  });
  it('/link/status with no session → 401 JSON', async () => {
    const r = await call('GET', '/link/status');
    expect(r.status).toBe(401);
    expect((await j(r)).code).toBe('UNAUTHORIZED');
  });

  it("pushes today's mirrors through /sync/push/:kind", async () => {
    const now = new Date(Date.now() - 1000).toISOString();
    const services = fixture('push-services.json');
    services.takenAt = now;
    services.rows[0].ymd = brisbaneToday(new Date());
    services.rows[0].startsAt = now;
    services.rows[0].checkedIn = [];
    const roster = fixture('push-roster.json');
    roster.takenAt = now;
    expect((await sync('/sync/push/services', services)).status).toBe(200);
    const r = await sync('/sync/push/roster', roster);
    expect(r.status).toBe(200);
    expect((await j(r)).applied).toBe(true);
  });

  it('POST /link/actions: saved → 201, replay → 200, duplicate → 409 LINK_DUPLICATE + existingId', async () => {
    const item = { id: randomUUID(), type: 'checkIn', payload: { serviceTimeId: svcTime, serviceId: svcId, personId: alex } };
    const a = await asAdmin('POST', '/link/actions', item);
    expect(a.status).toBe(201);
    expect((await j(a)).action).toMatchObject({ id: item.id, type: 'checkIn', status: 'pending' });
    const b = await asAdmin('POST', '/link/actions', item);
    expect(b.status).toBe(200);
    expect((await j(b)).outcome).toBe('replay');
    const d = await asAdmin('POST', '/link/actions', { ...item, id: randomUUID() });
    expect(d.status).toBe(409);
    expect(await j(d)).toMatchObject({ code: 'LINK_DUPLICATE', existingId: item.id });
  });

  it('DELETE /link/actions/:id cancels a pending row; a bad id → 400 with the error shape', async () => {
    const item = { id: randomUUID(), type: 'checkIn', payload: { serviceTimeId: svcTime, serviceId: svcId, personId: jamie } };
    expect((await asAdmin('POST', '/link/actions', item)).status).toBe(201);
    const r = await asAdmin('DELETE', `/link/actions/${item.id}`);
    expect(r.status).toBe(200);
    expect((await j(r)).outcome).toBe('cancelled');
    const bad = await asAdmin('DELETE', '/link/actions/not-a-uuid');
    expect(bad.status).toBe(400);
    expect((await j(bad)).code).toBe('VALIDATION_ERROR');
  });

  it('/link/batch as admin in Shadow, mixed batch → 200, one result per item, in order', async () => {
    const first = randomUUID();
    const body = { device: { id: 'd1', label: 'Test phone' }, items: [
      { kind: 'action', id: first, type: 'checkIn', payload: { serviceTimeId: svcTime, serviceId: svcId, personId: jamie } },
      { kind: 'action', id: randomUUID(), type: 'checkIn', payload: { serviceTimeId: svcTime, serviceId: svcId, personId: randomUUID() } },
      { kind: 'cancel', id: first },
      { kind: 'identity', id: randomUUID(), at: new Date().toISOString(), from: null, to: null },
    ] };
    const r = await asAdmin('POST', '/link/batch', body);
    expect(r.status).toBe(200);
    const { results } = await j(r);
    expect(results.map((x: { kind: string }) => x.kind)).toEqual(['action', 'action', 'cancel', 'identity']);
    expect(results[0]).toMatchObject({ id: first, outcome: 'saved' });
    expect(results[1].outcome).toBe('refused');
    expect(results[2].outcome).toBe('cancelled');
    expect(results[3].outcome).toBe('logged');
    expect(results.every((x: object) => !('httpStatus' in x))).toBe(true);
  });

  it('the device headers reach the action log', async () => {
    const r = await asAdmin('GET', '/link/admin/log');
    expect(r.status).toBe(200);
    const { rows } = await j(r);
    expect(rows.some((x: { deviceId: string; deviceLabel: string; event: string }) =>
      x.event === 'checkIn' && x.deviceId === 'd1' && x.deviceLabel === 'Test phone')).toBe(true);
  });

  it('every other /link GET route answers 200 as admin', async () => {
    for (const p of ['/link/status', `/link/checkin?serviceTime=${svcTime}`, '/link/lifegroups', '/link/flows',
      '/link/admin/roster', `/link/admin/shadow-check?date=${brisbaneToday(new Date())}`]) {
      const r = await asAdmin('GET', p);
      expect([p, r.status]).toEqual([p, 200]);
    }
  });
});
