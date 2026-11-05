// Friday night check, Task 4: POST /sync/night-summary over a live memory-mode server (harness as link.routes.test.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { NIGHT_SECTIONS } from '../core/link-contract';
import { claimArgs } from './helpers/link-repo-suite';

describe('POST /sync/night-summary', () => {
  const TOKEN = 'Sy' + 'n4'.repeat(20);
  const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW';
  const saved = { t: process.env['LINK_SYNC_TOKEN'], c: process.env['SETUP_CODE'] };
  const ME = '8f5a1c2e-0000-4000-8000-000000000001';
  let server: Server; let base = '';
  let seed: (id: string) => Promise<unknown>;
  let c: Awaited<ReturnType<typeof buildContainer>>;

  const body = (o: Record<string, unknown> = {}) => ({ contractVersion: 1, consoleId: ME, section: 'console',
    from: '2026-11-13T07:00:00.000Z', to: '2026-11-13T20:00:00.000Z', ...o });
  const post = (b: unknown, token: string | null = TOKEN) => fetch(`${base}/sync/night-summary`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(b) });

  beforeAll(async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    process.env['SETUP_CODE'] = CODE;
    c = await buildContainer();
    seed = (id) => c.repos.link.claim(claimArgs({}, id as ReturnType<typeof randomUUID>));
    server = createApp(buildRoutes(c.services), c.services.auth, c.services.health, c.services.errorLog).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    for (const [k, v] of [['LINK_SYNC_TOKEN', saved.t], ['SETUP_CODE', saved.c]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('no token gives a JSON 401', async () => {
    const r = await post(body(), null);
    expect(r.status).toBe(401);
    expect((await r.json() as any).code).toBe('UNAUTHORIZED');
  });
  it('a wrong contract version gives 409', async () => {
    const r = await post(body({ contractVersion: 2 }));
    expect(r.status).toBe(409);
    expect((await r.json() as any).code).toBe('LINK_CONTRACT_MISMATCH');
  });
  it('an unknown section gives 400', async () => {
    const r = await post(body({ section: 'roster' }));
    expect(r.status).toBe(400);
    expect((await r.json() as any).code).toBe('VALIDATION_ERROR');
  });
  it('a window over 48 h gives 400', async () => {
    expect((await post(body({ to: '2026-11-15T07:00:00.001Z' }))).status).toBe(400);
    expect((await post(body({ to: '2026-11-15T07:00:00.000Z' }))).status).toBe(200);   // exactly 48 h is allowed
  });
  it('every section answers 200 with its name and the contract version', async () => {
    for (const section of NIGHT_SECTIONS) {
      const r = await post(body({ section }));
      expect(r.status, section).toBe(200);
      expect(await r.json()).toMatchObject({ contractVersion: 1, section });
    }
  });
  it('a section that fails its schema answers 500 INTERNAL_ERROR with no details, logs one row, and never echoes the value', async () => {
    await c.repos.imports.save({ id: randomUUID(), type: 'service', filename: 'x.csv', fileHash: 'h', rowCount: 1, sessionsAdded: 1, studentsAdded: 0,
      studentsUpdated: 0, status: 'Sample', errorMessage: null, importedAt: '2026-11-13T09:00:00.000Z', importedBy: 'x' } as any);
    const before = (await c.repos.errorLog.list()).length;
    const r = await post(body({ section: 'imports' }));
    const text = await r.text();
    expect(r.status).toBe(500);
    expect(JSON.parse(text).code).toBe('INTERNAL_ERROR');
    expect(JSON.parse(text).details).toBeUndefined();
    expect(text).not.toMatch(/Sample|Dummyton|Codeman/);
    const rows = await c.repos.errorLog.list();
    expect(rows.length).toBe(before + 1);
    expect(rows.find((x) => x.route === 'POST /sync/night-summary')).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
  });
  it('an unregistered consoleId answers 200 with no self row; a registered one has exactly one', async () => {
    const none = await (await post(body({ consoleId: randomUUID() }))).json() as any;
    expect(none.data.consoles.some((c: any) => c.self)).toBe(false);
    await seed(ME);
    const some = await (await post(body())).json() as any;
    expect(some.data.consoles.filter((c: any) => c.self)).toHaveLength(1);
    expect(JSON.stringify(some)).not.toContain(ME);
  });
});
