// Y4-5: the real-database smoke test. About 209 of 280 production SQL statements never ran in a test (the rest of the
// suite is in-memory). Skipped unless LINK_TEST_DATABASE_URL is set: CI's throwaway Postgres sets it, nothing else does.
// It builds the real container on that database, seeds the demo data, calls every GET as admin and a few writes, and
// expects no 5xx. Last on purpose: the attendance import replaces the students.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const URL_ = process.env['LINK_TEST_DATABASE_URL'];
const NOW = new Date(Date.now() + 10 * 3600_000).toISOString().slice(0, 16); // Brisbane local time (the Bus clock check allows 36 h)

describe.skipIf(!URL_)('real-database smoke (CI Postgres only, never prod)', () => {
  let server: Server; let base = ''; let token = ''; let studentId = '';
  let getPaths: string[] = [];
  const call = async (method: string, path: string, body?: unknown) => {
    const p = path.startsWith('/bus') ? `${path}${path.includes('?') ? '&' : '?'}now=${NOW}` : path;
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return r.status;
  };

  beforeAll(async () => {
    if (!/@(localhost|127\.0\.0\.1)[:/]/.test(URL_!)) throw new Error('smoke test: LINK_TEST_DATABASE_URL must be a local Postgres');
    process.env['FIELD_ENCRYPTION_KEY'] ??= Buffer.alloc(32, 7).toString('base64'); // required under PERSISTENCE=supabase
    process.env['PERSISTENCE'] = 'supabase';
    process.env['DATABASE_URL'] = URL_;
    vi.resetModules(); // src/config/env.ts reads both at import
    const { buildContainer } = await import('../container');
    const { buildRoutes } = await import('../api/http/router');
    const { createApp } = await import('../api/http/express-adapter');
    const { seedDemoData } = await import('../seed');
    const c = await buildContainer();
    const pw = await seedDemoData(c.repos);
    if (!pw) throw new Error('smoke test: the database already has users; it needs a fresh one');
    const s = await c.repos.settings.getSettings();
    await c.repos.settings.updateSettings({ ministryConfig: { ...s.ministryConfig,
      modules: { ...s.ministryConfig.modules, busMinistry: true, notices: 'on' } } } as any);
    server = createApp(buildRoutes(c.services), c.services.auth).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin', password: pw }) });
    token = ((await r.json()) as { token?: string }).token ?? '';
    if (!token) throw new Error('smoke test: login failed (a run of 401s would pass as "below 500")');
    // Same route loop as phone-scope-sweep.test.ts: every GET, each :param tried with one student id, one leader id, 2026.
    const ids = [(await c.repos.students.findAll())[0]!.id, (await c.repos.leaders.findAll())[0]!.id];
    const out = new Set<string>();
    for (const rt of buildRoutes(c.services)) {
      if (rt.method !== 'GET' || rt.cron || rt.sync) continue; // token-gated routes answer 503 by design while their secret is unset
      if (!rt.path.includes(':')) { out.add(rt.path); continue; }
      for (const id of rt.path.includes(':year') ? ['2026'] : ids) out.add(rt.path.replace(/:[A-Za-z]+/g, id));
    }
    getPaths = [...out];
    studentId = ids[0]!;
  }, 60_000);
  afterAll(() => { server?.close(); });

  it('every GET answers below 500', async () => {
    expect(getPaths.length).toBeGreaterThan(50);
    const bad: string[] = []; let ok = 0;
    for (const p of getPaths) { const st = await call('GET', p); if (st >= 500) bad.push(`${st} ${p}`); if (st === 200) ok++; }
    expect(bad).toEqual([]);
    expect(ok).toBeGreaterThan(getPaths.length / 2); // a run of 401s or 404s is not a smoke test
  }, 120_000);

  it('three writes answer 2xx: bus rider, notice, attendance import', async () => {
    const rider = await call('POST', '/bus/riders', { studentId, newAddress: { label: 'Home', address: '1 Sample St, Dummyton', placeId: 'fake:smoke' } });
    const notice = await call('POST', '/notices', { title: 'Smoke', body: 'Smoke test notice', recipients: ['b79'] });
    const imp = await call('POST', '/import/csv', { filename: 'smoke.csv',
      rows: [{ first_name: 'Sample', last_name: 'Codeman', gender: 'male', grade: 9, '2026-02-06': 'Y' }] });
    // 2xx, not just below 500: a 4xx means the write SQL never ran. If one 4xxs for a real reason, fix the payload.
    for (const st of [rider, notice, imp]) { expect(st).toBeGreaterThanOrEqual(200); expect(st).toBeLessThan(300); }
  }, 60_000);
});
