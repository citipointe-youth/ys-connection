// Security review 2026-11-04 (lane C section 5): the role floor. Every `auth: true` route, called as the lowest login (junior `leader`),
// answers 403 or 404, or is on OPEN below. A new route with no gate fails here. It proves the floor only, not object-level scope: a 404
// can also mean the dummy id was not found. Memory repositories; any outbound fetch is refused.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import type { AuthService } from '../services/auth.service';
import { MinistryConfigSchema } from '../core/ministry-config';
import LIVE_MODULES from './fixtures/live-modules.json';

const ALL_ON = { notices: 'on', idChecks: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'on', busConsentForm: true };
const ID = 'b0000000-0000-4000-8000-000000000001';
// Reviewed 2026-11-04: a junior leader may reach these, and each scopes what it returns. 400 = the role check passed or is not the
// gate, and the empty body failed validation. `docs/areas/roles-terms.md` has the role rules; the probe matrix has the LEAK cells.
const OPEN = new Set<string>([
  // Self: own session, own password, the client error report. /auth/me is 401 only because this test's actor is not a stored user.
  'GET /auth/me', 'POST /auth/logout', 'POST /accounts/me/password', 'POST /admin/errors/client',
  // Own connected students, scoped in the service (F-10 for the export).
  'GET /batch', 'GET /students', 'GET /leaders', 'GET /connections', 'GET /connections/export', 'GET /at-risk',
  'GET /prayers', 'POST /prayers', 'GET /notices', 'POST /intake/new-youth', 'PUT /id-checks/entries/:id',
  // Bus: bus:use is open to every Bus login by design (redacted for a junior leader; Car setup 2026-10-15).
  'GET /bus/run', 'GET /bus/run/cars', 'GET /bus/run/version', 'PATCH /bus/run/pool', 'DELETE /bus/run/own-car', 'POST /bus/run/my-car/stops',
  'GET /bus/search', 'GET /bus/my-car', 'POST /bus/riders/:id/dropped', 'GET /bus/consent/status', 'POST /bus/consent-form',
  'POST /bus/vehicles', 'PATCH /bus/vehicles/:id', 'GET /bus/places/autocomplete', 'GET /bus/places/details',
  // Elvanto link screens: feature + scope checks in link.service.
  'GET /link/status', 'GET /link/checkin', 'GET /link/actions', 'POST /link/batch', 'GET /link/lifegroups', 'GET /link/youth', 'GET /link/flows',
]);

describe('every auth: true route as a junior leader', () => {
  let server: Server; let base = ''; let routes: ReturnType<typeof buildRoutes>;
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    vi.stubGlobal('fetch', (u: string | URL, o?: RequestInit) =>
      String(u).startsWith(base) ? realFetch(u, o) : Promise.reject(new Error('no outbound call in this test')));
    const c = await buildContainer();
    // Every module on: a module that is off answers 404 before the role check, which would hide a missing gate.
    await c.repos.settings.updateSettings({ ministryConfig: MinistryConfigSchema.parse({ modules: { ...LIVE_MODULES, ...ALL_ON } }) } as never);
    routes = buildRoutes(c.services);
    const actor = { id: 'u-leader', role: 'leader', displayName: 'Sample', email: 'sample', grade: null, quad: null, leaderId: 'l-sample' };
    server = createApp(routes, { resolveToken: async () => actor } as unknown as AuthService).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); vi.unstubAllGlobals(); });

  it('answers 403 or 404, or is on the OPEN list', async () => {
    const authed = routes.filter((r) => r.auth);
    expect(authed.length).toBeGreaterThan(50);
    const open: string[] = [];
    const localNow = new Date().toISOString().slice(0, 16); // Bus routes answer 400 before the role check without it
    for (const r of authed) {
      const key = `${r.method} ${r.path}`;
      const res = await fetch(`${base}${r.path.replace(':year', '2026').replace(/:\w+/g, ID)}?now=${localNow}`, { method: r.method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        ...(r.method === 'GET' || r.method === 'DELETE' ? {} : { body: '{}' }) });
      if (res.status !== 403 && res.status !== 404 && !OPEN.has(key)) open.push(`${key} answered ${res.status}`);
    }
    expect(open, 'gate the route, or add it to OPEN if a junior leader may reach it').toEqual([]);
  }, 30_000);
});
