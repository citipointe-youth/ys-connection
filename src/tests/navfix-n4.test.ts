// Fix round 2026-10-16 lane n4: New person request ids (S-5/D4) and the Unsent retry lock (C-B2).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { makeNewYouthService } from '../services/new-youth.service';
import * as EF from '../services/elvanto-forms';
import { InMemorySettingsRepository, InMemoryUnsentRepository } from '../repositories/in-memory';
import { SupabaseUnsentRepository } from '../repositories/supabase/supabase.unsent';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { decryptField } from '../utils/field-crypto';
import type { Actor } from '../core/entities/user';

const studentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-student-form.html'), 'utf8');
const parentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-parent-form.html'), 'utf8');
const ADMIN: Actor = { id: 'a-admin', role: 'admin' as any, displayName: 'A', grade: null as any, quad: null as any };
const INPUT = {
  host: 'Sam Host', firstName: 'Alex', lastName: 'Zebedee', dob: '2012-04-03',
  gender: 'f', grade: '8', school: 'CCC', mobile: '0412 345 678',
  parentFirst: 'Pat', parentLast: 'Zebedee', parentMobile: '0498 765 432',
};

/** POSTs answer from `posts` in order after `delayMs` ('ok' | 'fail' | 'down'). Counts POSTs. */
function fakeFetch(posts: ('ok' | 'fail' | 'down')[], delayMs = 0) {
  const n = { posts: 0 };
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') return new Response(String(url).includes(EF.STUDENT_FORM_ID) ? studentHtml : parentHtml, { status: 200 });
    n.posts++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const p = posts.shift() ?? 'ok';
    if (p === 'ok') return new Response('<p>OK-TEST</p>', { status: 200 });
    if (p === 'down') return new Response('', { status: 500 });
    return new Response('<form><input name="save"></form>', { status: 200 });
  });
  return { fetchFn: fn as unknown as typeof fetch, n };
}

async function settingsOn() {
  const settings = new InMemorySettingsRepository();
  await settings.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: 'on' } } } as any);
  return settings;
}
async function setup(posts: ('ok' | 'fail' | 'down')[] = [], delayMs = 0, unsent = new InMemoryUnsentRepository()) {
  const settings = await settingsOn();
  const f = fakeFetch(posts, delayMs);
  const errorLog = { record: vi.fn(async () => {}) };
  const svc = makeNewYouthService(settings, { fetchFn: f.fetchFn, live: true, unsent, errorLog });
  return { svc, unsent, errorLog, n: f.n, settings };
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

describe('S-5/D4 migration 0032', () => {
  const m = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0032_newperson_requests.sql'), 'utf8');
  it('is additive, keyed on the request id, and turns RLS on', () => {
    expect(m).toMatch(/create table if not exists newperson_requests/);
    expect(m).toMatch(/id text primary key/);
    expect(m).toMatch(/created_by text not null/);
    expect(m).toMatch(/result jsonb/);
    expect(m).toMatch(/create index if not exists newperson_requests_created_idx on newperson_requests\(created_at\)/);
    expect(m).toMatch(/alter table newperson_requests enable row level security/);
    expect(m).not.toMatch(/\b(drop|alter column|rename)\b/i);
  });
});

describe('S-5/D4 InMemoryUnsentRepository request claims', () => {
  it('first claim is fresh; a second sees null until finished, then the result; null finish frees the id; purge drops old', async () => {
    const r = new InMemoryUnsentRepository();
    expect(await r.claimRequest('q1', 'u1')).toEqual({ fresh: true, result: null });
    expect(await r.claimRequest('q1', 'u1')).toEqual({ fresh: false, result: null });
    await r.finishRequest('q1', { student: 'sent' });
    expect(await r.claimRequest('q1', 'u1')).toEqual({ fresh: false, result: { student: 'sent' } });
    await r.finishRequest('q1', null);
    expect((await r.claimRequest('q1', 'u1')).fresh).toBe(true);
    await r.purgeBefore(new Date(Date.now() + 1000).toISOString());
    expect((await r.claimRequest('q1', 'u1')).fresh).toBe(true);
  });
});

describe('S-5/D4 SupabaseUnsentRepository request SQL', () => {
  function fakeSql(rowsFor: (text: string) => any[]) {
    const calls: { text: string; values: unknown[] }[] = [];
    const sql: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      calls.push({ text, values });
      return Promise.resolve(rowsFor(text));
    };
    sql.json = (v: unknown) => ({ json: v });
    return { sql, calls };
  }
  it('claim inserts on conflict do nothing; a lost insert reads the stored result', async () => {
    const f = fakeSql((t) => (t.startsWith('insert') ? [] : [{ result: { student: 'sent' } }]));
    const r = new SupabaseUnsentRepository(f.sql);
    expect(await r.claimRequest('q1', 'u1')).toEqual({ fresh: false, result: { student: 'sent' } });
    expect(f.calls[0]!.text).toMatch(/^insert into newperson_requests \(id, created_by\) values \(\?, \?\) on conflict \(id\) do nothing returning id$/);
    expect(f.calls[1]!.text).toMatch(/^select result from newperson_requests where id = \?$/);
    const g = fakeSql(() => [{ id: 'q1' }]);
    expect(await new SupabaseUnsentRepository(g.sql).claimRequest('q1', 'u1')).toEqual({ fresh: true, result: null });
    expect(g.calls).toHaveLength(1);
  });
  it('finish stores jsonb, or deletes on null; purge also clears old requests', async () => {
    const f = fakeSql(() => []);
    const r = new SupabaseUnsentRepository(f.sql);
    await r.finishRequest('q1', { a: 1 });
    await r.finishRequest('q2', null);
    await r.purgeBefore('2026-10-01T00:00:00.000Z');
    expect(f.calls[0]!.text).toBe('update newperson_requests set result = ? where id = ?');
    expect(f.calls[0]!.values[0]).toEqual({ json: { a: 1 } });
    expect(f.calls[1]!.text).toBe('delete from newperson_requests where id = ?');
    expect(f.calls.map((c) => c.text)).toContain('delete from newperson_requests where created_at < ?');
  });
});

describe('S-5/D4 New person request id', () => {
  it('same requestId twice at once on two instances -> one Elvanto POST pair; the second is a repeat', async () => {
    const unsent = new InMemoryUnsentRepository();
    const one = await setup(['ok', 'ok'], 30, unsent), two = await setup(['ok', 'ok'], 30, unsent);
    const requestId = randomUUID();
    // two instances: the in-memory 2-min map can't see the other one, only the DB claim can
    const [a, b] = await Promise.all([one.svc.send(ADMIN, { ...INPUT, requestId }), two.svc.send(ADMIN, { ...INPUT, requestId })]);
    expect(one.n.posts + two.n.posts).toBe(2);
    expect([a, b].filter((r) => r.repeat)).toHaveLength(1);
    expect([a, b].find((r) => r.repeat)).toMatchObject({ student: 'unconfirmed', parent: 'unconfirmed' });
  });
  it('a NEW service instance (another Vercel instance) answers the same id from the repo', async () => {
    const unsent = new InMemoryUnsentRepository();
    const one = await setup(['ok', 'ok'], 0, unsent);
    const requestId = randomUUID();
    const first = await one.svc.send(ADMIN, { ...INPUT, requestId });
    const two = await setup(['ok', 'ok'], 0, unsent);
    const again = await two.svc.send(ADMIN, { ...INPUT, requestId });
    expect(two.n.posts).toBe(0);
    expect(again).toMatchObject({ student: 'sent', parent: 'sent', ref: first.ref, repeat: true });
  });
  it('a rejected send frees the id so the fixed retry goes', async () => {
    const unsent = new InMemoryUnsentRepository();
    const one = await setup(['fail'], 0, unsent);
    const requestId = randomUUID();
    expect((await one.svc.send(ADMIN, { ...INPUT, requestId })).student).toBe('failed');
    const two = await setup(['ok', 'ok'], 0, unsent);
    expect((await two.svc.send(ADMIN, { ...INPUT, requestId })).student).toBe('sent');
    expect(two.n.posts).toBe(2);
  });
  it('a claim error fails OPEN: the send goes and the error log gets NY_REQ_FAILED', async () => {
    const unsent = new InMemoryUnsentRepository();
    unsent.claimRequest = async () => { throw new Error('db down'); };
    const t = await setup(['ok', 'ok'], 0, unsent);
    const r = await t.svc.send(ADMIN, { ...INPUT, requestId: randomUUID() });
    expect(r.student).toBe('sent');
    expect(t.n.posts).toBe(2);
    expect(t.errorLog.record).toHaveBeenCalledWith(expect.objectContaining({ code: 'NY_REQ_FAILED' }));
  });
  it('a finish error fails open too', async () => {
    const unsent = new InMemoryUnsentRepository();
    unsent.finishRequest = async () => { throw new Error('db down'); };
    const t = await setup(['ok', 'ok'], 0, unsent);
    expect((await t.svc.send(ADMIN, { ...INPUT, requestId: randomUUID() })).student).toBe('sent');
  });
  it('a bad or missing requestId is ignored (no claim, send goes)', async () => {
    const t = await setup(['ok', 'ok', 'ok', 'ok']);
    const spy = vi.spyOn(t.unsent, 'claimRequest');
    expect((await t.svc.send(ADMIN, { ...INPUT, requestId: 'nope' })).student).toBe('sent');
    expect((await t.svc.send(ADMIN, { ...INPUT, firstName: 'Bo' })).student).toBe('sent');
    expect(spy).not.toHaveBeenCalled();
  });
  it('the stored unsent payload never keeps the requestId', async () => {
    const t = await setup(['down']);
    await t.svc.send(ADMIN, { ...INPUT, requestId: randomUUID() });
    const [row] = await t.unsent.list();
    expect(JSON.parse(decryptField(row!.payload, `newperson_unsent.payload:${row!.id}`))).not.toHaveProperty('requestId');
  });
});

describe('C-B2 Unsent retry lock (server)', () => {
  it('two concurrent retries of one row -> one student+parent POST pair; the second is 409 UNSENT_BUSY', async () => {
    const t = await setup(['fail', 'ok', 'ok', 'ok', 'ok'], 30);
    await t.svc.send(ADMIN, INPUT); // student rejected -> saved as failed
    const [row] = await t.unsent.list();
    t.n.posts = 0;
    const res = await Promise.allSettled([t.svc.unsentRetry(ADMIN, row!.id, {}), t.svc.unsentRetry(ADMIN, row!.id, {})]);
    expect(t.n.posts).toBe(2);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const bad = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(bad.reason).toMatchObject({ code: 'UNSENT_BUSY', statusCode: 409 });
    expect(bad.reason.message).toBe('Already resending. Wait for it to finish.');
  });
  it('a retry that failed again can be retried (the row changed, so a new key)', async () => {
    const t = await setup(['fail', 'fail', 'ok', 'ok']);
    await t.svc.send(ADMIN, INPUT);
    const [row] = await t.unsent.list();
    await new Promise((r) => setTimeout(r, 5)); // updatedAt moves on
    expect((await t.svc.unsentRetry(ADMIN, row!.id, {})).student).toBe('failed');
    expect((await t.svc.unsentRetry(ADMIN, row!.id, {})).student).toBe('sent');
  });
});
