// T10 (UX batch 2026-10-14b): encrypted queue of New person sends that did not land.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeNewYouthService } from '../services/new-youth.service';
import * as EF from '../services/elvanto-forms';
import { InMemorySettingsRepository, InMemoryUnsentRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { isEncrypted } from '../utils/field-crypto';
import type { Actor } from '../core/entities/user';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { seedDemoData } from '../seed';

const studentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-student-form.html'), 'utf8');
const parentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-parent-form.html'), 'utf8');
const ADMIN: Actor = { id: 'a-admin', role: 'admin' as any, displayName: 'A', grade: null as any, quad: null as any };
const GRADE: Actor = { id: 'a-grade', role: 'grade' as any, displayName: 'G', grade: 9 as any, quad: null as any };
const INPUT = {
  host: 'Sam Host', firstName: 'Alex', lastName: 'Zebedee', dob: '2012-04-03',
  gender: 'f', grade: '8', school: 'CCC', mobile: '0412 345 678',
  parentFirst: 'Pat', parentLast: 'Zebedee', parentMobile: '0498 765 432',
};

/** POSTs answer from `posts` in order ('ok' | 'fail' | 'down'); GETs answer `getStatus`. */
function fakeFetch(posts: ('ok' | 'fail' | 'down')[], getStatus = 200) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if ((init?.method ?? 'GET') === 'GET') {
      return new Response(u.includes(EF.STUDENT_FORM_ID) ? studentHtml : parentHtml, { status: getStatus });
    }
    const p = posts.shift() ?? 'ok';
    if (p === 'ok') return new Response('<p>OK-TEST</p>', { status: 200 });
    if (p === 'down') return new Response('', { status: 500 });
    return new Response('<form><input name="save"></form>', { status: 200 });
  });
  return fn as unknown as typeof fetch;
}

async function setup(posts: ('ok' | 'fail' | 'down')[], getStatus = 200) {
  const settings = new InMemorySettingsRepository();
  await settings.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: 'on' } } } as any);
  const unsent = new InMemoryUnsentRepository();
  const errorLog = { record: vi.fn(async () => {}) };
  const svc = makeNewYouthService(settings, { fetchFn: fakeFetch(posts, getStatus), live: true, unsent, errorLog });
  return { svc, unsent, errorLog };
}

const KEY_VARS = ['FIELD_ENCRYPTION_KEY', 'FIELD_ENCRYPTION_KEY_ID'] as const;
const oldEnv: Record<string, string | undefined> = {};
const saved = { student: { ...EF.SUCCESS.student }, parent: { ...EF.SUCCESS.parent } };
beforeAll(() => {
  for (const k of KEY_VARS) oldEnv[k] = process.env[k];
  process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.FIELD_ENCRYPTION_KEY_ID = 't1';
});
afterAll(() => { for (const k of KEY_VARS) { if (oldEnv[k] === undefined) delete process.env[k]; else process.env[k] = oldEnv[k]; } });
beforeEach(() => { EF.SUCCESS.student.marker = 'OK-TEST'; EF.SUCCESS.parent.marker = 'OK-TEST'; });
afterEach(() => { Object.assign(EF.SUCCESS.student, saved.student); Object.assign(EF.SUCCESS.parent, saved.parent); });

describe('InMemoryUnsentRepository', () => {
  it('save upserts but keeps createdAt; list is oldest first; remove; purgeBefore', async () => {
    const r = new InMemoryUnsentRepository();
    await r.save({ id: 'b', reason: 'failed', payload: 'x', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });
    await r.save({ id: 'a', reason: 'failed', payload: 'x', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
    await r.save({ id: 'b', reason: 'unconfirmed', payload: 'y', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' });
    expect((await r.list()).map((x) => x.id)).toEqual(['a', 'b']);
    expect((await r.list())[1]).toMatchObject({ reason: 'unconfirmed', payload: 'y', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' });
    await r.purgeBefore('2026-10-01T12:00:00.000Z');
    expect((await r.list()).map((x) => x.id)).toEqual(['b']);
    expect(await r.remove('b')).toBe(true);
    expect(await r.remove('b')).toBe(false);
  });
});

describe('New person unsent queue', () => {
  it('an unconfirmed send is stored ENCRYPTED (no name or phone at rest) and listed decrypted for the admin', async () => {
    const { svc, unsent, errorLog } = await setup(['down']);
    const res = await svc.send(GRADE, INPUT);
    expect(res).toMatchObject({ student: 'unconfirmed', queued: true });
    const [row] = await unsent.list();
    expect(row!.reason).toBe('unconfirmed');
    expect(isEncrypted(row!.payload)).toBe(true);
    expect(row!.payload).not.toMatch(/Alex|Zebedee|0412|0498/);
    for (const c of errorLog.record.mock.calls) expect(JSON.stringify(c)).not.toMatch(/Alex|Zebedee|0412|0498/);
    const { rows } = await svc.unsentList(ADMIN);
    expect(rows[0]).toMatchObject({ reason: 'unconfirmed', name: 'Alex Zebedee', host: 'Sam Host', grade: '8', forms: ['student'] }); // the parent form landed
  });

  it('keeps only the form that did not land (student sent, parent rejected)', async () => {
    const { svc } = await setup(['ok', 'fail']);
    expect(await svc.send(GRADE, INPUT)).toMatchObject({ student: 'sent', parent: 'failed', queued: true });
    expect((await svc.unsentList(ADMIN)).rows[0]).toMatchObject({ reason: 'failed', forms: ['parent'] });
  });

  it('Elvanto unreachable before any POST: saved, and the host is told so', async () => {
    const { svc } = await setup([], 503);
    await expect(svc.send(GRADE, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_UNREACHABLE', statusCode: 502, message: expect.stringContaining('Saved for the admin to resend') });
    expect((await svc.unsentList(ADMIN)).rows[0]).toMatchObject({ reason: 'unreachable', forms: ['student', 'parent'] });
  });

  it('a clean send stores nothing and clears an older saved row for the same person', async () => {
    const { svc, unsent } = await setup(['fail', 'ok', 'ok']);
    expect((await svc.send(GRADE, INPUT)).queued).toBe(true);
    expect(await unsent.list()).toHaveLength(1);
    const res = await svc.send(GRADE, INPUT); // the host tried again and it landed
    expect(res).toMatchObject({ student: 'sent', parent: 'sent' });
    expect(res.queued).toBeUndefined();
    expect(await unsent.list()).toHaveLength(0);
  });

  it('retry: unconfirmed needs confirm; a landed resend removes the row', async () => {
    const { svc, unsent } = await setup(['down', 'ok', 'ok']); // student unconfirmed, parent sent
    await svc.send(GRADE, INPUT);
    const [row] = await unsent.list();
    await expect(svc.unsentRetry(ADMIN, row!.id, {})).rejects.toMatchObject({ code: 'UNSENT_CHECK_ELVANTO', statusCode: 409 });
    const res = await svc.unsentRetry(ADMIN, row!.id, { confirm: true });
    expect(res).toMatchObject({ student: 'sent', parent: 'skipped' }); // only the form that did not land is resent
    expect(await unsent.list()).toHaveLength(0);
  });

  it('retry that fails again updates the same row (no duplicate)', async () => {
    const { svc, unsent } = await setup(['fail', 'fail']);
    await svc.send(GRADE, INPUT);
    const [row] = await unsent.list();
    expect((await svc.unsentRetry(ADMIN, row!.id, undefined)).queued).toBe(true);
    const rows = await unsent.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(row!.id);
  });

  it('purges rows older than 14 days on read', async () => {
    const { svc, unsent } = await setup(['fail']);
    await svc.send(GRADE, INPUT);
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
    await unsent.save({ id: 'old', reason: 'failed', payload: 'v1.x.x.x.x', createdAt: old, updatedAt: old });
    unsent.rows.get('old')!.createdAt = old;
    const { rows } = await svc.unsentList(ADMIN);
    expect(rows.map((r) => r.id)).not.toContain('old');
    expect(rows).toHaveLength(1);
  });

  it('admin only: list, retry and delete refuse a grade login; delete removes', async () => {
    const { svc, unsent } = await setup(['fail']);
    await svc.send(GRADE, INPUT);
    const [row] = await unsent.list();
    await expect(svc.unsentList(GRADE)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.unsentRetry(GRADE, row!.id, { confirm: true })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.unsentDelete(GRADE, row!.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await svc.unsentDelete(ADMIN, row!.id)).toEqual({ ok: true });
    await expect(svc.unsentDelete(ADMIN, row!.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('no key: nothing is stored, the host is not told it was saved', async () => {
    const k = process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;
    try {
      const { svc, unsent, errorLog } = await setup(['down']);
      const res = await svc.send(GRADE, INPUT);
      expect(res.queued).toBeUndefined();
      expect(await unsent.list()).toHaveLength(0);
      expect(errorLog.record).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNSENT_SAVE_FAILED' }));
    } finally { process.env.FIELD_ENCRYPTION_KEY = k; }
  });
});

describe('Unsent routes (memory, seeded)', () => {
  let server: Server; let base = '';
  const tokens: Record<string, string> = {};
  const call = (method: string, path: string, tok?: string) => fetch(base + path, { method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}) });

  beforeAll(async () => {
    const { repos, services } = await buildContainer();
    await seedDemoData(repos);
    server = createApp(buildRoutes(services), services.auth, services.health, services.errorLog).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const u of ['admin', 'grade7']) {
      const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: u, password: 'demo1234' }) });
      tokens[u] = ((await r.json()) as any).token;
    }
  });
  afterAll(() => { server.close(); });

  const ROUTES = [['GET', '/admin/unsent'], ['POST', '/admin/unsent/x/retry'], ['DELETE', '/admin/unsent/x']] as const;
  it('no token → 401; grade login → 403; admin reads an empty list and gets 404 for an unknown id', async () => {
    for (const [m, p] of ROUTES) {
      expect((await call(m, p)).status).toBe(401);
      expect((await call(m, p, tokens['grade7'])).status).toBe(403);
    }
    const r = await call('GET', '/admin/unsent', tokens['admin']);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ rows: [] });
    expect((await call('POST', '/admin/unsent/x/retry', tokens['admin'])).status).toBe(404);
    expect((await call('DELETE', '/admin/unsent/x', tokens['admin'])).status).toBe(404);
  });
});

describe('migration 0023', () => {
  it('is additive and turns RLS on for newperson_unsent', () => {
    const m = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0023_newperson_unsent.sql'), 'utf8');
    expect(m).toMatch(/create table if not exists newperson_unsent/);
    expect(m).toMatch(/alter table newperson_unsent enable row level security/);
    expect(m).not.toMatch(/\b(drop|alter column|rename)\b/i);
  });
});
