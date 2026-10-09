import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { LATEST_MIGRATION } from '../core/schema-version';
import type { Services } from '../container';

const j = async (r: Response): Promise<any> => r.json();
const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW';
const savedEnv = { ...process.env };
const restoreEnv = () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
};

describe('setup routes (memory mode, empty user repo)', () => {
  let server: Server;
  let base: string;
  let services: Services;
  let adminToken = '';

  beforeAll(async () => {
    process.env['SETUP_CODE'] = CODE;
    ({ services } = await buildContainer());
    const app = createApp(buildRoutes(services), services.auth, services.health);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); restoreEnv(); });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('1. GET /settings includes needsAdmin:true on an empty repo', async () => {
    const r = await fetch(base + '/settings');
    expect(r.status).toBe(200);
    expect((await j(r)).needsAdmin).toBe(true);
  });

  it('2. GET /setup/status is public, has checks[], no stack and no env values', async () => {
    const r = await fetch(base + '/setup/status');
    expect(r.status).toBe(200);
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.needsAdmin).toBe(true);
    expect(Array.isArray(body.checks)).toBe(true);
    expect(text).not.toContain('stack');
    expect(text).not.toContain(CODE);
  });

  it('3. POST /setup/admin with the right code -> { token, user.email === admin }', async () => {
    const r = await post('/setup/admin', { code: CODE.toLowerCase().replace(/-/g, ' '), displayName: 'Pat', password: 'longenough' });
    expect(r.status).toBe(200);
    const body = await j(r);
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe('admin');
    expect(body.user.passwordHash).toBeUndefined();
    adminToken = body.token;
  });

  it('4. then GET /setup/status without a token -> 401; with the new token -> 200, no setupCode row', async () => {
    expect((await fetch(base + '/setup/status')).status).toBe(401);
    const r = await fetch(base + '/setup/status', { headers: { authorization: `Bearer ${adminToken}` } });
    expect(r.status).toBe(200);
    const body = await j(r);
    expect(body.needsAdmin).toBe(false);
    expect(body.checks.map((c: { id: string }) => c.id)).not.toContain('setupCode');
  });

  it('5. POST /setup/admin again -> 409', async () => {
    const r = await post('/setup/admin', { code: CODE, displayName: 'X', password: 'longenough' });
    expect(r.status).toBe(409);
    expect((await j(r)).message).toBe('An admin already exists. Log in.');
  });

  it('6. 31 rapid POST /setup/admin with a wrong code from one IP -> the 31st is 429', async () => {
    const h = { 'x-forwarded-for': '203.0.113.77' };
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post('/setup/admin', { code: 'WRONG', displayName: 'X', password: 'longenough' }, h)).status;
    expect(last).toBe(429);
  });

  it('7. GET /health reports db and schema', async () => {
    const r = await fetch(base + '/health');
    const body = await j(r);
    expect(body).toMatchObject({ status: 'ok', db: 'ok', schema: { current: LATEST_MIGRATION, expected: LATEST_MIGRATION } });
    expect(typeof body.ts).toBe('string');
  });

  it('8. POST /bus/google-check: no auth -> 401; grade user -> 403; admin -> 400 when Google is not set up', async () => {
    expect((await post('/bus/google-check', {})).status).toBe(401);
    const now = new Date().toISOString();
    await services.users.save({
      id: 'grade-user-1', displayName: 'G', email: 'grade9g', role: 'grade', grade: 9, grades: [9], gender: 'female',
      quad: null, leaderId: null, status: 'active', mustChangePassword: false, createdAt: now, updatedAt: now,
    });
    const gradeToken = (await services.auth.issueTokenFor('grade-user-1'))!;
    expect((await post('/bus/google-check', {}, { authorization: `Bearer ${gradeToken}` })).status).toBe(403);
    const saved = { ...process.env };
    for (const k of ['GOOGLE_SA_JSON', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY', 'GOOGLE_PROJECT_ID', 'GOOGLE_MAPS_API_KEY']) delete process.env[k];
    try {
      const r = await post('/bus/google-check', {}, { authorization: `Bearer ${adminToken}` });
      expect(r.status).toBe(400);
    } finally { Object.assign(process.env, saved); }
  });

  it('8b. GET /bus/run carries google{state,missing,text} for admin only', async () => {
    const now = new Date().toISOString().slice(0, 16);
    const on = await fetch(base + '/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ ministryConfig: { modules: { busMinistry: true } } }) });
    expect(on.status).toBe(200);
    const admin = await fetch(`${base}/bus/run?now=${now}`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect(admin.status).toBe(200);
    const body = await j(admin);
    expect(body.google).toMatchObject({ state: expect.any(String), missing: expect.any(Array), text: expect.any(String) });
    const gradeToken = (await services.auth.issueTokenFor('grade-user-1'))!;
    const grade = await fetch(`${base}/bus/run?now=${now}`, { headers: { authorization: `Bearer ${gradeToken}` } });
    if (grade.status === 200) expect((await j(grade)).google).toBeUndefined();
  });
});

describe('production without SESSION_SECRET', () => {
  afterEach(() => { restoreEnv(); vi.resetModules(); });

  async function bootProd() {
    vi.resetModules();
    process.env['NODE_ENV'] = 'production';
    delete process.env['SESSION_SECRET'];
    process.env['PERSISTENCE'] = 'memory';
    const { buildContainer: bc } = await import('../container');
    const { buildRoutes: br } = await import('../api/http/router');
    const { createApp: ca } = await import('../api/http/express-adapter');
    const { services } = await bc();
    const server = ca(br(services), services.auth, services.health).listen(0);
    return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }

  it('9. login for an unknown user -> 503 SETUP_INCOMPLETE', async () => {
    const { server, base } = await bootProd();
    try {
      const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody', password: 'whatever1' }) });
      expect(r.status).toBe(503);
      expect((await j(r)).code).toBe('SETUP_INCOMPLETE');
    } finally { server.close(); }
  });

  it('10. setup routes still work; a protected route is 401', async () => {
    const { server, base } = await bootProd();
    try {
      expect((await fetch(base + '/setup/status')).status).toBe(200);
      expect((await fetch(base + '/students')).status).toBe(401);
    } finally { server.close(); }
  });
});

describe('seed guard in createAppInstance', () => {
  afterEach(() => { restoreEnv(); vi.resetModules(); });

  async function needsAdminAfterBoot(vercelEnv: string | undefined) {
    vi.resetModules();
    process.env['PERSISTENCE'] = 'memory';
    if (vercelEnv === undefined) delete process.env['VERCEL_ENV']; else process.env['VERCEL_ENV'] = vercelEnv;
    const { createAppInstance } = await import('../app');
    const server = (await createAppInstance()).listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/settings`);
      return (await j(r)).needsAdmin as boolean;
    } finally { server.close(); }
  }

  it('11. memory mode on VERCEL_ENV=production creates no users', async () => {
    expect(await needsAdminAfterBoot('production')).toBe(true);
  });
  it('11b. memory mode elsewhere still seeds the demo admin', async () => {
    expect(await needsAdminAfterBoot(undefined)).toBe(false);
  });
});
