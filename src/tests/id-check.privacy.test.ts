// ID Checks privacy guard (Task 11, spec 2026-10-30 §7.9): nothing outside the module reads the tables or the repo
// (no export, backup, digest or audit path), and the module's controller and service never log.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { seedDemoData } from '../seed';

const SRC = join(__dirname, '..');
const OWN = new Set([
  'core/entities/id-check.ts', 'core/id-check-questions.ts', 'services/id-check.service.ts', 'services/id-check-rhythm.ts',
  'repositories/supabase/supabase.id-checks.ts', 'repositories/supabase/index.ts', 'repositories/in-memory/id-checks.repository.ts',
  'repositories/in-memory/index.ts', 'repositories/interfaces/entity-repositories.ts', 'container.ts', 'seed.ts',
  'api/http/router.ts', 'api/controllers/id-check.controller.ts',
]);
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'tests' ? [] : files(p)) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('ID Checks privacy', () => {
  it('no reader outside the module: tables, repo and service are named nowhere else in src/', () => {
    const hits = files(SRC)
      .map((p) => relative(SRC, p).replace(/\\/g, '/'))
      .filter((r) => !OWN.has(r))
      .filter((r) => /id_check_|IdCheckRepository|idChecks?\s*[.:]\s*\w*(list|leader|upsert|ticks|archived|repo)|IdCheckService|makeIdCheckService/
        .test(readFileSync(join(SRC, r), 'utf8')));
    expect(hits).toEqual([]);
  });
  it('the controller and service never log', () => {
    for (const f of ['api/controllers/id-check.controller.ts', 'services/id-check.service.ts']) {
      const code = readFileSync(join(SRC, f), 'utf8');
      expect(code, f).not.toMatch(/console\./);
      expect(code, f).not.toMatch(/errorLog/);
    }
  });
});

// HTTP round trip on the seeded memory app: proves the routes, the PUT method in the adapter and the seed.

describe('/id-checks over HTTP (seeded memory app)', () => {
  it('seed ticks; list, leader, PUT, archived; admin unticked 404; module off 404', async () => {
    const { repos, services } = await buildContainer();
    await seedDemoData(repos, 'test-only-pass');
    const cfg = (await repos.settings.getSettings()).ministryConfig;
    await repos.settings.updateSettings({ ministryConfig: { ...cfg, modules: { ...cfg.modules, idChecks: 'on' } } });
    const server = createApp(buildRoutes(services), services.auth, services.health).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const tok = async (u: string) => ((await (await fetch(base + '/auth/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u, password: 'test-only-pass' }) })).json()) as { token: string }).token;
      const call = async (t: string, method: string, path: string, body?: unknown) => {
        const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: r.status, body: await r.json() as any };
      };
      const [ov, ov2, admin] = [await tok('oversight'), await tok('oversight2'), await tok('admin')];
      const list = await call(ov, 'GET', '/id-checks');
      expect(list.status).toBe(200);
      expect(list.body.leaders.map((l: { name: string }) => l.name).sort()).toEqual(['James Thompson', 'Sample Dummyton']);
      const sample = list.body.leaders.find((l: { name: string }) => l.name === 'Sample Dummyton');
      expect(sample.lastCheckOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((await call(ov2, 'GET', '/id-checks')).body.leaders.map((l: { name: string }) => l.name)).toEqual(['Sample Dummyton']);
      const one = await call(ov2, 'GET', `/id-checks/leaders/${sample.id}`);
      expect(one.body.leader.name).toBe('Sample Dummyton');
      expect(one.body.entries[0].content.answers.faith01.asked).toBe(true);
      expect(one.body.entries[0].mine).toBe(false);
      const put = await call(ov2, 'PUT', `/id-checks/entries/${randomUUID()}`,
        { leaderId: sample.id, kind: 'note', heldOn: '2026-10-30', finished: false, content: { text: 'Fictional note' } });
      expect(put).toMatchObject({ status: 200, body: { finished: false } });
      expect(typeof put.body.updatedAt).toBe('string');
      expect((await call(admin, 'GET', `/id-checks/leaders/${sample.id}`)).status).toBe(404);
      expect((await call(admin, 'GET', '/id-checks')).body.leaders).toEqual([]);
      expect((await call(admin, 'GET', '/id-checks/archived'))).toEqual({ status: 200, body: [] });
      expect((await call(admin, 'GET', '/id-checks/access')).body.ticks).toHaveLength(3);
      await repos.settings.updateSettings({ ministryConfig: { ...cfg, modules: { ...cfg.modules, idChecks: 'off' } } });
      expect((await call(ov, 'GET', '/id-checks')).body.code).toBe('MODULE_DISABLED');
    } finally { server.close(); }
  });
});
