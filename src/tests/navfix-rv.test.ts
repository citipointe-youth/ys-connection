// Fix round 2026-10-16 review fixes (RV-*): server side.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { makeNewYouthService } from '../services/new-youth.service';
import * as EF from '../services/elvanto-forms';
import { brisbaneElvanto } from './helpers/brisbane-elvanto';
const BRIS = brisbaneElvanto();
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
    if ((init?.method ?? 'GET') === 'GET') return new Response(String(url).includes(BRIS.studentFormId) ? studentHtml : parentHtml, { status: 200 });
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
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, elvanto: BRIS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: 'on' } } } as any);
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

describe('RV-S-M1 partial New person send keeps the claim', () => {
  it('student sent + parent failed, same requestId again -> no second student POST (DB claim and recent map)', async () => {
    const unsent = new InMemoryUnsentRepository();
    const one = await setup(['ok', 'fail'], 0, unsent);
    const requestId = randomUUID();
    const first = await one.svc.send(ADMIN, { ...INPUT, requestId });
    expect(first).toMatchObject({ student: 'sent', parent: 'failed', queued: true });
    one.n.posts = 0;
    const again = await one.svc.send(ADMIN, { ...INPUT, requestId }); // same instance: the recent map
    expect(one.n.posts).toBe(0);
    expect(again).toMatchObject({ student: 'sent', parent: 'failed', repeat: true });
    const two = await setup(['ok', 'ok'], 0, unsent); // another instance: the DB claim
    const again2 = await two.svc.send(ADMIN, { ...INPUT, requestId });
    expect(two.n.posts).toBe(0);
    expect(again2).toMatchObject({ student: 'sent', parent: 'failed', ref: first.ref, repeat: true });
  });
});

describe('RV-S-m4 an Unsent retry claim whose finish was lost expires after 10 min', () => {
  it('in memory: an unfinished claim older than staleMs is taken over (fresh); a younger one or a finished one is not', async () => {
    const r = new InMemoryUnsentRepository();
    await r.claimRequest('retry:x:1', 'a');
    expect(await r.claimRequest('retry:x:1', 'a', 600_000)).toEqual({ fresh: false, result: null });
    (r as any).reqs.get('retry:x:1').createdAt = new Date(Date.now() - 11 * 60_000).toISOString();
    expect(await r.claimRequest('retry:x:1', 'a')).toEqual({ fresh: false, result: null }); // no staleMs: never taken over
    expect(await r.claimRequest('retry:x:1', 'a', 600_000)).toEqual({ fresh: true, result: null });
    expect(await r.claimRequest('retry:x:1', 'a', 600_000)).toEqual({ fresh: false, result: null }); // the takeover is fresh again
  });
  it('service: a lost finish blocks the row with 409 only until the claim is 10 min old', async () => {
    const t = await setup(['fail', 'ok', 'ok']);
    await t.svc.send(ADMIN, INPUT); // student rejected -> saved
    const [row] = await t.unsent.list();
    const key = `retry:${row!.id}:${row!.updatedAt}`;
    await t.unsent.claimRequest(key, ADMIN.id); // a retry whose finish never came back
    await expect(t.svc.unsentRetry(ADMIN, row!.id, {})).rejects.toMatchObject({ code: 'UNSENT_BUSY' });
    (t.unsent as any).reqs.get(key).createdAt = new Date(Date.now() - 11 * 60_000).toISOString();
    expect((await t.svc.unsentRetry(ADMIN, row!.id, {})).student).toBe('sent');
  });
  it('Supabase: the takeover is one conditional update, only when staleMs is passed', async () => {
    const calls: string[] = [];
    const sql: any = (strings: TemplateStringsArray, ...v: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push(text);
      return Promise.resolve(text.startsWith('insert') ? [] : text.startsWith('update') ? [{ id: 'k' }] : [{ result: null }]);
    };
    expect(await new SupabaseUnsentRepository(sql).claimRequest('k', 'u', 600_000)).toEqual({ fresh: true, result: null });
    expect(calls[1]).toBe('update newperson_requests set created_at = now(), created_by = ? where id = ? and result is null and created_at < now() - make_interval(secs => ?) returning id');
  });
});

describe('RV-S-m5 newperson_requests are purged on the send path (already: clear()/keep() purge on every live send)', () => {
  it('a successful send purges request rows over 14 days; so does a failed one', async () => {
    const old = () => ({ by: 'x', result: { student: 'sent' }, createdAt: new Date(Date.now() - 15 * 86_400_000).toISOString() });
    const t = await setup(['ok', 'ok']);
    t.unsent.reqs.set('old', old());
    expect((await t.svc.send(ADMIN, { ...INPUT, requestId: randomUUID() })).student).toBe('sent');
    expect(t.unsent.reqs.has('old')).toBe(false);
    const u = await setup(['fail']);
    u.unsent.reqs.set('old', old());
    expect((await u.svc.send(ADMIN, { ...INPUT, requestId: randomUUID() })).student).toBe('failed');
    expect(u.unsent.reqs.has('old')).toBe(false);
  });
});
