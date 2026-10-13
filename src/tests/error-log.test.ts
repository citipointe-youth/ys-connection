// T3 admin Error log: repo (memory), service, capture points (adapter 5xx, sync results/sweep, New person), routes + RBAC,
// migration 0019. The log must never hold a name, phone, body or raw error text.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { InMemoryErrorLogRepository } from '../repositories/in-memory/error-log.repository';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemorySettingsRepository, InMemoryStudentRepository, InMemoryUserRepository } from '../repositories/in-memory';
import { makeErrorLogService, normaliseRoute, messageFor, CLIENT_REPORT_MAX } from '../services/error-log.service';
import { makeSyncService } from '../services/sync.service';
import { dedupeKey } from '../services/link-rules';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { seedDemoData } from '../seed';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { ErrorLogEntry } from '../repositories/interfaces/error-log.repository';

const DAY = 86_400_000;
const j = async (r: Response): Promise<any> => r.json();
const admin = { id: 'a1', role: 'admin', displayName: 'A', grade: null, quad: null } as Actor;
const grade = { id: 'g1', role: 'grade', displayName: 'G', grade: 9, quad: null } as Actor;
const entry = (over: Partial<ErrorLogEntry> = {}): ErrorLogEntry => ({ id: 'x', category: 'server', code: 'INTERNAL_ERROR',
  route: 'GET /students', status: 500, message: 'm', role: 'admin', at: '2026-10-13T00:00:00.000Z', ...over });

describe('InMemoryErrorLogRepository', () => {
  it('groups by id: count, first/last seen, last role; flags survive a repeat', async () => {
    const r = new InMemoryErrorLogRepository();
    await r.record(entry());
    await r.setFlags('x', { ignored: true, minimised: true });
    await r.record(entry({ at: '2026-10-14T00:00:00.000Z', role: 'grade' }));
    const [row] = await r.list();
    expect(row).toMatchObject({ count: 2, firstSeen: '2026-10-13T00:00:00.000Z', lastSeen: '2026-10-14T00:00:00.000Z',
      lastRole: 'grade', ignored: true, minimised: true });
  });
  it('setCount stores the count; last_seen moves only when it changes', async () => {
    const r = new InMemoryErrorLogRepository();
    await r.record(entry(), 3);
    await r.record(entry({ at: '2026-10-15T00:00:00.000Z' }), 3);
    expect((await r.list())[0]).toMatchObject({ count: 3, lastSeen: '2026-10-13T00:00:00.000Z' });
    await r.record(entry({ at: '2026-10-16T00:00:00.000Z' }), 4);
    expect((await r.list())[0]).toMatchObject({ count: 4, lastSeen: '2026-10-16T00:00:00.000Z' });
  });
  it('removeAll by category, remove, purgeBefore; unknown ids return false', async () => {
    const r = new InMemoryErrorLogRepository();
    await r.record(entry({ id: 'a', category: 'link' }));
    await r.record(entry({ id: 'b', category: 'client' }));
    await r.record(entry({ id: 'c', category: 'client', at: '2026-01-01T00:00:00.000Z' }));
    expect(await r.removeAll('link')).toBe(1);
    await r.purgeBefore('2026-06-01T00:00:00.000Z');
    expect((await r.list()).map((x) => x.id)).toEqual(['b']);
    expect(await r.remove('nope')).toBe(false);
    expect(await r.setFlags('nope', { ignored: true })).toBe(false);
    expect(await r.remove('b')).toBe(true);
  });
});

describe('error-log.service', () => {
  const mk = (now = new Date('2026-10-13T10:00:00Z')) => {
    const repo = new InMemoryErrorLogRepository();
    const link = new InMemoryLinkRepository({ now: () => now });
    return { repo, link, svc: makeErrorLogService({ repo, link, now: () => now }) };
  };

  it('same category+code+route+status → one row; a different status is a different row', async () => {
    const { svc } = mk();
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500 });
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500, role: 'grade' });
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 503 });
    const { rows } = await svc.list(admin);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.status === 500)).toMatchObject({ count: 2, lastRole: 'grade', message: 'Unexpected server error' });
  });

  it('record never throws, even when the repo does', async () => {
    const repo = new InMemoryErrorLogRepository();
    repo.record = async () => { throw new Error('db down'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(makeErrorLogService({ repo }).record({ category: 'server', code: 'X', route: 'r' })).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('list / flags / delete are admin only', async () => {
    const { svc } = mk();
    await expect(svc.list(grade)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.setFlags(grade, 'x', { ignored: true })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.remove(grade, 'x')).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.removeAll(grade, undefined)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('flags, delete, delete all for a category; bad input refused', async () => {
    const { svc } = mk();
    await svc.record({ category: 'client', code: 'JS_TypeError', route: 'line 1:2' });
    await svc.record({ category: 'link', code: 'too-old', route: 'checkIn' });
    const [row] = (await svc.list(admin)).rows.filter((r) => r.category === 'client');
    await svc.setFlags(admin, row!.id, { ignored: true });
    expect((await svc.list(admin)).rows.find((r) => r.id === row!.id)!.ignored).toBe(true);
    await expect(svc.setFlags(admin, row!.id, {})).rejects.toBeTruthy();
    await expect(svc.setFlags(admin, 'nope', { ignored: true })).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.removeAll(admin, 'bogus')).rejects.toBeTruthy();
    expect(await svc.removeAll(admin, 'link')).toEqual({ deleted: 1 });
    await svc.remove(admin, row!.id);
    expect((await svc.list(admin)).rows).toEqual([]);
  });

  it('list purges rows last seen more than 90 days ago', async () => {
    const { repo, svc } = mk();
    await repo.record(entry({ id: 'old', at: new Date(Date.parse('2026-10-13T10:00:00Z') - 91 * DAY).toISOString() }));
    await repo.record(entry({ id: 'new', at: new Date(Date.parse('2026-10-13T10:00:00Z') - 89 * DAY).toISOString() }));
    expect((await svc.list(admin)).rows.map((r) => r.id)).toEqual(['new']);
  });

  it('client reports: sanitised, fixed message, query stripped, ids folded; never the raw text', async () => {
    const { svc } = mk();
    await svc.reportClient(grade, { kind: 'api', code: 'INTERNAL_ERROR', route: 'GET /students/9e0a-11?q=Sam Smith', status: 500 });
    await svc.reportClient(grade, { kind: 'js', code: 'TypeError: Sam Smith 0412345678', route: 'line 12:3' });
    await svc.reportClient(grade, { kind: 'api', code: '', route: 'POST /link/batch', status: 0 });
    const rows = (await svc.list(admin)).rows;
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/Sam|Smith|0412/);
    expect(rows.map((r) => [r.code, r.route]).sort()).toEqual([
      ['INTERNAL_ERROR', 'GET /students/:id'], ['JS_TypeError', 'line 12:3'], ['NETWORK', 'POST /link/batch']].sort());
    expect(rows.every((r) => r.category === 'client' && r.lastRole === 'grade')).toBe(true);
    await expect(svc.reportClient(grade, { kind: 'evil' })).rejects.toBeTruthy();
  });

  it(`client reports are rate-limited per login (${CLIENT_REPORT_MAX} per window), quietly`, async () => {
    const { svc } = mk();
    const other = { ...grade, id: 'g2' } as Actor;
    for (let i = 0; i < CLIENT_REPORT_MAX; i++) expect(await svc.reportClient(grade, { kind: 'js', code: 'E', route: `line ${i}` })).toEqual({ ok: true });
    expect(await svc.reportClient(grade, { kind: 'js', code: 'E', route: 'line x' })).toEqual({ ok: false });
    expect(await svc.reportClient(other, { kind: 'js', code: 'E', route: 'line x' })).toEqual({ ok: true });
  });

  it('stale sweep: pending link rows older than 24 h are counted per type, without growing on each view', async () => {
    const now = new Date('2026-10-13T10:00:00Z');
    const { link, svc } = mk(now);
    const add = async (id: string, ageH: number) => {
      const payload = { serviceTimeId: '57000000-0000-4000-8000-000000000001', serviceId: '5e000000-0000-4000-8000-000000000001', personId: id };
      await link.insertAction({ id, type: 'checkIn', payload, note: null, dedupeKey: dedupeKey('checkIn', payload), serviceDate: '2026-10-10',
        studentId: null, personId: id, createdBy: 'u', leaderId: null, leaderName: 'L' });
      link._backdate('link_outbox', id, 'created_at', new Date(now.getTime() - ageH * 3_600_000).toISOString());
    };
    await add('9e000000-0000-4000-8000-000000000001', 30);
    await add('9e000000-0000-4000-8000-000000000002', 26);
    await add('9e000000-0000-4000-8000-000000000003', 2);
    await svc.list(admin);
    const { rows } = await svc.list(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'link', code: 'pending-24h', route: 'checkIn', count: 2 });
  });

  it('normaliseRoute / messageFor', () => {
    expect(normaliseRoute('get /a/1b/c?x=1#y')).toBe('GET /a/:id/c');
    expect(messageFor('link', 'report-changed', null)).toBe('The console refused this action');
    expect(messageFor('server', 'WEIRD', 502)).toBe('Server error (502)');
  });
});

describe('capture: sync claim + result', () => {
  const CONSOLE = '8f5a1c2e-0000-4000-8000-000000000001';
  const claimReq = JSON.parse(readFileSync(join(__dirname, 'fixtures/elvanto-link/claim-request.json'), 'utf8'));
  const id = (n: number) => `0b000000-0000-4000-8000-00000000000${n}`;

  async function setup() {
    const link = new InMemoryLinkRepository();
    const settings = new InMemorySettingsRepository();
    await settings.init();
    await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
      modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, checkin: 'on', lifegroupReport: 'on', flows: 'on' } } } as any);
    const users = new InMemoryUserRepository();
    const record = vi.fn(async () => {});
    const svc = makeSyncService({ link, settings, students: new InMemoryStudentRepository(), users, errorLog: { record } });
    for (const n of [1, 2, 3]) {
      const payload = { serviceTimeId: '57000000-0000-4000-8000-000000000001', serviceId: '5e000000-0000-4000-8000-000000000001',
        personId: `9e000000-0000-4000-8000-00000000000${n}` };
      await link.insertAction({ id: id(n), type: 'checkIn', payload, note: null, dedupeKey: dedupeKey('checkIn', payload),
        serviceDate: '2026-10-16', studentId: null, personId: payload.personId, createdBy: 'u', leaderId: null, leaderName: 'L' });
    }
    return { link, svc, record };
  }

  it('the too-old sweep is recorded (type + reason)', async () => {
    const { link, svc, record } = await setup();
    link._backdate('link_outbox', id(1), 'created_at', new Date(Date.now() - 4 * DAY).toISOString());
    await svc.claim(claimReq);
    expect(record).toHaveBeenCalledWith({ category: 'link', code: 'too-old', route: 'checkIn', role: 'console' });
  });

  it('refused and unclear results are recorded once each; sent is not', async () => {
    const { svc, record } = await setup();
    await svc.claim({ ...claimReq, max: 6 });
    record.mockClear();
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [
      { id: id(1), outcome: 'refused', reason: 'person-unknown', detail: 'Sam Smith not found' },
      { id: id(2), outcome: 'unclear', sentLogKey: 'k2', detail: 'x' },
      { id: id(3), outcome: 'sent', sentLogKey: 'k3' },
    ] });
    expect(record.mock.calls).toEqual([
      [{ category: 'link', code: 'person-unknown', route: 'checkIn', role: 'console' }],
      [{ category: 'link', code: 'unclear', route: 'checkIn', role: 'console' }],
    ]);
    // A replay of the same result is ignored by the repo, so it is not counted twice.
    record.mockClear();
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: id(1), outcome: 'refused', reason: 'person-unknown' }] });
    expect(record).not.toHaveBeenCalled();
  });
});

describe('Error log routes (memory, seeded)', () => {
  let server: Server; let base = '';
  const tokens: Record<string, string> = {};
  const call = (method: string, path: string, tok?: string, body?: unknown) => fetch(base + path, { method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  beforeAll(async () => {
    const { repos, services } = await buildContainer();
    await seedDemoData(repos);
    // A route that crashes, to prove the adapter logs a 5xx (code + route + role, never the message).
    const routes = [...buildRoutes(services), { method: 'GET' as const, path: '/admin/boom', auth: true,
      handler: async () => { throw new Error('secret Sam Smith 0412345678'); } }];
    server = createApp(routes, services.auth, services.health, services.errorLog).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const u of ['admin', 'grade7']) {
      const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: u, password: 'demo1234' }) });
      tokens[u] = (await j(r)).token;
    }
  });
  afterAll(() => { server.close(); });

  it('no token → 401 JSON on every Error log route', async () => {
    for (const [m, p] of [['GET', '/admin/errors'], ['DELETE', '/admin/errors'], ['POST', '/admin/errors/client'],
      ['PATCH', '/admin/errors/x'], ['DELETE', '/admin/errors/x']] as const) {
      const r = await call(m, p);
      expect(r.status).toBe(401);
      expect((await j(r)).code).toBe('UNAUTHORIZED');
    }
  });

  it('a grade login may report but not read, flag or delete', async () => {
    expect((await call('POST', '/admin/errors/client', tokens['grade7'], { kind: 'js', code: 'TypeError', route: 'line 1:1' })).status).toBe(200);
    for (const [m, p] of [['GET', '/admin/errors'], ['DELETE', '/admin/errors'], ['PATCH', '/admin/errors/x'], ['DELETE', '/admin/errors/x']] as const) {
      expect((await call(m, p, tokens['grade7'], m === 'PATCH' ? { ignored: true } : undefined)).status).toBe(403);
    }
  });

  it('a 500 is logged by the adapter; admin reads, ignores and deletes it', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('GET', '/admin/boom', tokens['grade7'])).status).toBe(500);
    warn.mockRestore();
    const list = await j(await call('GET', '/admin/errors', tokens['admin']));
    expect(JSON.stringify(list)).not.toMatch(/Sam|0412|secret/);
    const boom = list.rows.find((r: any) => r.route === 'GET /admin/boom');
    expect(boom).toMatchObject({ category: 'server', code: 'INTERNAL_ERROR', status: 500, lastRole: 'grade', count: 1 });
    expect(list.rows.some((r: any) => r.category === 'client' && r.code === 'JS_TypeError')).toBe(true);
    expect((await call('PATCH', `/admin/errors/${boom.id}`, tokens['admin'], { ignored: true })).status).toBe(200);
    expect((await call('DELETE', `/admin/errors/${boom.id}`, tokens['admin'])).status).toBe(200);
    expect((await j((await call('DELETE', '/admin/errors?category=client', tokens['admin'])))).deleted).toBe(1);
  });

  it('/admin is in vercel.json and sw.js API_RE (no new top-level prefix)', () => {
    const root = join(__dirname, '..', '..');
    const src = new RegExp(JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).routes[0].src);
    expect(src.test('/admin/errors/client')).toBe(true);
    const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
    const re = new Function(`${sw.match(/const API_RE = .*;/)![0]} return API_RE;`)() as RegExp;
    expect(re.test('/admin/errors')).toBe(true);
  });
});

describe('migration 0019', () => {
  it('is additive and turns RLS on for error_log', () => {
    const m = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0019_error_log.sql'), 'utf8');
    expect(m).toMatch(/create table if not exists error_log/);
    expect(m).toMatch(/alter table error_log enable row level security/);
    expect(m).not.toMatch(/\b(drop|alter column|rename)\b/i);
  });
});
