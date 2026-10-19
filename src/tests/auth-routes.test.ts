// Y-C5 (PY-P10): controllers no longer re-check req.ctx; the adapter's 401 is the one guard. This pins it for
// every `auth: true` route (path params filled with a dummy), so a route added later cannot skip it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';

describe('every auth: true route answers 401 with no session', () => {
  let server: Server; let base = ''; let routes: ReturnType<typeof buildRoutes>;
  beforeAll(async () => {
    const c = await buildContainer();
    routes = buildRoutes(c.services);
    server = createApp(routes, c.services.auth).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });

  it('401 JSON for each', async () => {
    const authed = routes.filter((r) => r.auth);
    expect(authed.length).toBeGreaterThan(50);
    for (const r of authed) {
      const res = await fetch(base + r.path.replace(/:\w+/g, 'x'), { method: r.method, headers: { 'content-type': 'application/json' },
        ...(r.method === 'GET' || r.method === 'DELETE' ? {} : { body: '{}' }) });
      expect([r.method, r.path, res.status]).toEqual([r.method, r.path, 401]);
    }
  });
});
