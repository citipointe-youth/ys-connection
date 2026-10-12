import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { seedDemoData } from '../seed';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';

const j = async (r: Response): Promise<any> => r.json();
const NOW = new Date().toISOString().slice(0, 16);

describe('oct rework routes (memory mode, seeded)', () => {
  let server: Server;
  let base: string;
  let leaderId = '';
  const tokens: Record<string, string> = {};

  const login = async (u: string) => {
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u, password: 'demo1234' }) });
    return (await j(r)).token as string;
  };

  beforeAll(async () => {
    const { repos, services } = await buildContainer();
    await seedDemoData(repos);
    const cur = await repos.settings.getSettings();
    await repos.settings.updateSettings({
      ministryConfig: { ...cur.ministryConfig, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, ...cur.ministryConfig.modules, newYouthForms: 'shadow', busMinistry: true } },
    });
    const l = (await repos.leaders.findAll())[0]!;
    leaderId = l.id;
    server = createApp(buildRoutes(services), services.auth, services.health).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const u of ['admin', 'g79', 'grade7']) tokens[u] = await login(u);
  });
  afterAll(() => { server.close(); });

  const patch = (tok: string | null, body: unknown) =>
    fetch(`${base}/leaders/${leaderId}/view-grades`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
  const cars = (tok: string | null) =>
    fetch(`${base}/bus/run/cars?now=${NOW}`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} });

  it('PATCH /leaders/:id/view-grades: no token -> 401 JSON', async () => {
    const r = await patch(null, { grades: [7] });
    expect(r.status).toBe(401);
    expect((await j(r)).code).toBe('UNAUTHORIZED');
  });
  it('quad sets viewGrades', async () => {
    const r = await patch(tokens['g79']!, { grades: [7] });
    expect(r.status).toBe(200);
    expect((await j(r)).viewGrades).toEqual([7]);
  });
  it('grade login is refused', async () => {
    expect((await patch(tokens['grade7']!, { grades: [7] })).status).toBe(403);
  });
  it('GET /bus/run/cars: no token -> 401 JSON', async () => {
    const r = await cars(null);
    expect(r.status).toBe(401);
    expect((await j(r)).code).toBe('UNAUTHORIZED');
  });
  it('GET /bus/run/cars: admin and quad 200 (T10: All cars follows the Bus module only, not New person Shadow)', async () => {
    expect((await cars(tokens['admin']!)).status).toBe(200);
    expect((await cars(tokens['g79']!)).status).toBe(200);
  });
});
