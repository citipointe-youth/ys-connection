// T3 admin Error log: repo (memory), service, capture points (adapter 5xx, sync results/sweep, New person), routes + RBAC,
// migration 0019. The log must never hold a name, phone, body or raw error text.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { InMemoryErrorLogRepository } from '../repositories/in-memory/error-log.repository';
import { SupabaseErrorLogRepository } from '../repositories/supabase/supabase.error-log';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemorySettingsRepository, InMemoryStudentRepository, InMemoryUserRepository } from '../repositories/in-memory';
import { makeErrorLogService, normaliseRoute, CLIENT_REPORT_MAX } from '../services/error-log.service';
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
  route: 'GET /students', status: 500, message: 'm', tier: 'later', foldKey: null, role: 'admin', at: '2026-10-13T00:00:00.000Z', ...over });

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
  it('fold: joins the newest row with the same fold key seen in the last 30 min, else starts a new row', async () => {
    const r = new InMemoryErrorLogRepository();
    const at = (m: number) => new Date(Date.parse('2026-10-16T10:36:00Z') + m * 60_000).toISOString();
    await r.record(entry({ id: 'a', foldKey: 'SERVICE_UNAVAILABLE|503', route: 'GET /a', at: at(0) }));
    await r.record(entry({ id: 'b', foldKey: 'SERVICE_UNAVAILABLE|503', route: 'GET /b', at: at(3), n: 5 }));
    expect(await r.list()).toHaveLength(1);
    expect((await r.list())[0]).toMatchObject({ id: 'a', route: 'GET /a', count: 6, lastSeen: at(3) });
    await r.record(entry({ id: 'c', foldKey: 'SERVICE_UNAVAILABLE|503', at: at(40) })); // 37 min after the last one
    expect((await r.list()).map((x) => x.id).sort()).toEqual(['a', 'c']);
  });
  it('F4 2026-10-22: a new occurrence never joins an ignored row; it starts a fresh row that shows again', async () => {
    const r = new InMemoryErrorLogRepository();
    const at = (m: number) => new Date(Date.parse('2026-10-16T10:36:00Z') + m * 60_000).toISOString();
    await r.record(entry({ id: 'a', foldKey: 'SERVICE_UNAVAILABLE|503', route: 'GET /a', at: at(0) }));
    await r.setFlags('a', { ignored: true });
    await r.record(entry({ id: 'b', foldKey: 'SERVICE_UNAVAILABLE|503', route: 'GET /b', at: at(3) }));
    await r.record(entry({ id: 'c', foldKey: 'SERVICE_UNAVAILABLE|503', route: 'GET /c', at: at(5) }));
    const rows = await r.list();
    expect(rows.find((x) => x.id === 'a')).toMatchObject({ count: 1, ignored: true });
    expect(rows.find((x) => x.id === 'b')).toMatchObject({ count: 2, ignored: false, route: 'GET /b' });
    expect(rows.find((x) => x.id === 'c')).toBeUndefined();
  });
  it('F4 2026-10-22: the Supabase fold skips ignored rows', async () => {
    const q: string[] = [];
    const sql = ((s: TemplateStringsArray) => { q.push(s.join('?')); return Promise.resolve([]); }) as any;
    await new SupabaseErrorLogRepository(sql).record(entry({ id: 'a', foldKey: 'X|503' }));
    expect(q[0]).toMatch(/where fold_key = \?\s+and not ignored/);
  });
  it('setCount 0 deletes the row; setCount n stores n', async () => {
    const r = new InMemoryErrorLogRepository();
    await r.record(entry({ id: 'p', category: 'link', code: 'pending-24h', tier: 'now' }), 2);
    expect((await r.list())[0]).toMatchObject({ count: 2, tier: 'now', foldKey: null });
    await r.record(entry({ id: 'p' }), 0);
    expect(await r.list()).toEqual([]);
  });
  it('removeAll by tier deletes only that tier; old rows without a fold key still upsert by id', async () => {
    const r = new InMemoryErrorLogRepository();
    await r.record(entry({ id: 'f', tier: 'fyi' }));
    await r.record(entry({ id: 'l', tier: 'later' }));
    await r.record(entry({ id: 'l', tier: 'later', at: '2026-10-14T00:00:00.000Z' }));
    expect(await r.removeAll(undefined, 'fyi')).toBe(1);
    expect(await r.list()).toMatchObject([{ id: 'l', count: 2 }]);
  });
});

describe('error-log.service', () => {
  const mk = (start = new Date('2026-10-13T10:00:00Z')) => {
    const clock = { now: start };
    const repo = new InMemoryErrorLogRepository();
    const link = new InMemoryLinkRepository({ now: () => clock.now });
    return { repo, link, clock, svc: makeErrorLogService({ repo, link, now: () => clock.now }) };
  };
  const later = (c: { now: Date }, s: number) => { c.now = new Date(c.now.getTime() + s * 1000); };

  it('same category+code+route+status → one row; a different status is a different row', async () => {
    const { svc, clock } = mk();
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500 });
    later(clock, 31);
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500, role: 'grade' });
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 503 });
    const { rows } = await svc.list(admin);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.status === 500)).toMatchObject({ count: 2, lastRole: 'grade', tier: 'later',
      line1: 'A screen failed with a server error (GET /x)' });
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
    svc.setKnownRoutes(['GET /students/:id', 'POST /link/batch']);
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

  it('review fix: a client route outside the router table and a code outside the known set never reach the log as text', async () => {
    const { svc } = mk();
    svc.setKnownRoutes(['GET /students/:id']);
    await svc.reportClient(grade, { kind: 'api', code: 'SAM_SMITH_0412345678', route: 'GET /Sam-Smith-secret', status: 500 });
    await svc.reportClient(grade, { kind: 'api', code: 'SAM_SMITH_0412345678', route: 'GET /students/7', status: 0 });
    const rows = (await svc.list(admin)).rows;
    expect(JSON.stringify(rows)).not.toMatch(/Sam|SAM|0412|secret/i);
    expect(rows.map((r) => [r.code, r.route]).sort()).toEqual([['CLIENT_ERROR', 'GET /students/:id'], ['HTTP_500', 'page']].sort());
  });
  it('review fix: intake-unreadable has its own text, not the console-refusal fallback', async () => {
    const { svc } = mk();
    await svc.record({ category: 'link', code: 'intake-unreadable', route: 'GET /link/intake/row' });
    expect((await svc.list(admin)).rows[0]!.line1).toBe('A saved intake plan could not be decrypted');
  });
  it('R8: a route with a named param matches the router table, not page', async () => {
    const { svc } = mk();
    svc.setKnownRoutes(['GET /prayers/student/:studentId']);
    await svc.reportClient(grade, { kind: 'api', code: 'INTERNAL_ERROR', route: 'GET /prayers/student/9e000000-0000-4000-8000-000000000011', status: 500 });
    expect((await svc.list(admin)).rows[0]!.route).toBe('GET /prayers/student/:id');
  });
  it('R5: one write per fingerprint per 30 s; the skipped count rides the next write; setCount is never throttled', async () => {
    const { svc, repo, clock } = mk();
    const spy = vi.spyOn(repo, 'record');
    const rec = { category: 'server' as const, code: 'SERVICE_UNAVAILABLE', route: 'GET /x', status: 503 };
    await svc.record(rec); await svc.record(rec); await svc.record(rec);
    expect(spy).toHaveBeenCalledTimes(1);
    later(clock, 31);
    await svc.record(rec);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0].n).toBe(3);
    expect((await svc.list(admin)).rows[0]!.count).toBe(4);
    await svc.record({ category: 'link', code: 'pending-24h', route: 'checkIn' }, 2);
    await svc.record({ category: 'link', code: 'pending-24h', route: 'checkIn' }, 2);
    expect(spy).toHaveBeenCalledTimes(4);
  });
  it('record adds its count in one write', async () => {
    const { svc, clock } = mk();
    await svc.record({ category: 'link', code: 'too-old', route: 'checkIn', count: 3 });
    later(clock, 31);
    await svc.record({ category: 'link', code: 'too-old', route: 'checkIn', count: 2 });
    expect((await svc.list(admin)).rows[0]!.count).toBe(5);
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

  it('normaliseRoute', () => {
    expect(normaliseRoute('get /a/1b/c?x=1#y')).toBe('GET /a/:id/c');
    expect(normaliseRoute('GET /a/deadbeef/c')).toBe('GET /a/:id/c');
    expect(normaliseRoute('GET /a/abcdefghijklmnopqrst')).toBe('GET /a/:id');
    expect(normaliseRoute('GET /link/flows/step')).toBe('GET /link/flows/step');
  });
  it('fold: the six-route 503 burst is one entry (×6); its later client copy joins it', async () => {
    const { svc, clock } = mk();
    for (const p of ['/a', '/b', '/c', '/d', '/e', '/f']) { await svc.record({ category: 'server', code: 'SERVICE_UNAVAILABLE', route: `GET ${p}`, status: 503 }); later(clock, 31); }
    await svc.record({ category: 'client', code: 'SERVICE_UNAVAILABLE', route: 'GET /a', status: 503 });
    const { rows } = await svc.list(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 7, tier: 'fyi', line1: 'The database was busy for a moment', counted: false });
  });
  it('sliding window: one error every 20 min for 2 h is one entry; a 31 min gap starts a new one', async () => {
    const { svc, clock } = mk();
    for (let i = 0; i < 7; i++) { await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500 }); later(clock, 20 * 60); }
    expect((await svc.list(admin)).rows).toHaveLength(1);
    later(clock, 11 * 60 + 1); // 31 min after the last one
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500 });
    expect((await svc.list(admin)).rows.map((r) => r.count).sort()).toEqual([1, 7]);
  });
  it('link rows fold per reason AND type; a different type is its own entry', async () => {
    const { svc, clock } = mk();
    await svc.record({ category: 'link', code: 'person-unknown', route: 'checkIn' }); later(clock, 31);
    await svc.record({ category: 'link', code: 'person-unknown', route: 'checkIn', count: 2 });
    await svc.record({ category: 'link', code: 'person-unknown', route: 'addGroupMember' });
    const rows = (await svc.list(admin)).rows;
    expect(rows.map((r) => [r.route, r.count]).sort()).toEqual([['addGroupMember', 1], ['checkIn', 3]]);
  });
  it('list returns tier/line1/line2 and sorts now, later, fyi', async () => {
    const { svc } = mk();
    await svc.record({ category: 'server', code: 'SERVICE_UNAVAILABLE', route: 'GET /x', status: 503 });
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /y', status: 500 });
    await svc.record({ category: 'link', code: 'locked', route: 'consentSave' });
    const rows = (await svc.list(admin)).rows;
    expect(rows.map((r) => r.tier)).toEqual(['now', 'later', 'fyi']);
    expect(rows[0]).toMatchObject({ line1: "Consent save isn't switched on in the console" });
    expect(rows.every((r) => r.line2.length > 0)).toBe(true);
  });
  it('setCount keeps a fixed id; setCount 0 deletes it', async () => {
    const { svc } = mk();
    await svc.record({ category: 'reconcile', code: 'recon-unmatched', route: '' }, 96);
    await svc.record({ category: 'reconcile', code: 'recon-unmatched', route: '' }, 95);
    let rows = (await svc.list(admin)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 95, tier: 'later', counted: true, line1: '95 roster students have no student record in YS' });
    await svc.record({ category: 'reconcile', code: 'recon-unmatched', route: '' }, 0);
    rows = (await svc.list(admin)).rows;
    expect(rows).toEqual([]);
  });
  it('pending back to zero: the pending-24h entry clears itself once nothing waits', async () => {
    const now = new Date('2026-10-13T10:00:00Z');
    const { link, svc } = mk(now);
    const id = '9e000000-0000-4000-8000-000000000001';
    const payload = { serviceTimeId: '57000000-0000-4000-8000-000000000001', serviceId: '5e000000-0000-4000-8000-000000000001', personId: id };
    await link.insertAction({ id, type: 'checkIn', payload, note: null, dedupeKey: dedupeKey('checkIn', payload), serviceDate: '2026-10-10',
      studentId: null, personId: id, createdBy: 'u', leaderId: null, leaderName: 'L' });
    link._backdate('link_outbox', id, 'created_at', new Date(now.getTime() - 30 * 3_600_000).toISOString());
    expect((await svc.list(admin)).rows).toMatchObject([{ code: 'pending-24h', tier: 'now', line1: '1 check-in action has waited over 24 hours' }]);
    link._backdate('link_outbox', id, 'created_at', now.toISOString()); // stands in for "the console picked it up"
    expect((await svc.list(admin)).rows).toEqual([]);
  });
  it('YSREL2 fix: a recheck row pending past 24 h never writes an Error log line', async () => {
    const repo = new InMemoryErrorLogRepository();
    const old = new Date(Date.parse('2026-10-13T10:00:00Z') - 30 * 3_600_000).toISOString();
    const link = { listActions: async () => [{ type: 'recheck', createdAt: old }] } as any;
    const svc = makeErrorLogService({ repo, link, now: () => new Date('2026-10-13T10:00:00Z') });
    expect((await svc.list(admin)).rows).toEqual([]);
  });
  it('YSREL2 fix: "Tap Check again" only for a re-checkable type while the console lists recheck live', async () => {
    const at = '2026-10-13T10:00:00Z';
    const view = async (caps: Record<string, string> | null, route: string) => {
      const repo = new InMemoryErrorLogRepository();
      // D1: the unclear row is the sweep's live count of the open unclear action.
      const link = { listActions: async (f: any) => (f.statuses?.includes('unclear') ? [{ type: route, reason: null }] : []),
        listConsoles: async () => (caps ? [{ lastSeenAt: at, capabilities: caps }] : []) } as any;
      const svc = makeErrorLogService({ repo, link, now: () => new Date(at) });
      return (await svc.list(admin)).rows[0]!.line2;
    };
    expect(await view({ recheck: 'live' }, 'checkIn')).toMatch(/^Tap Check again/);
    expect(await view({ recheck: 'live' }, 'intakeSave')).toMatch(/^Check it in Elvanto/); // not re-checkable
    expect(await view({ recheck: 'off' }, 'checkIn')).toMatch(/^Check it in Elvanto/);
    expect(await view({ checkIn: 'live' }, 'checkIn')).toMatch(/^Check it in Elvanto/); // rev 14 console
    expect(await view(null, 'checkIn')).toMatch(/^Check it in Elvanto/);
  });
  it('removeAll by tier (Clear FYI) deletes FYI rows only; a bad tier is refused', async () => {
    const { svc } = mk();
    await svc.record({ category: 'server', code: 'SERVICE_UNAVAILABLE', route: 'GET /x', status: 503 });
    await svc.record({ category: 'server', code: 'INTERNAL_ERROR', route: 'GET /y', status: 500 });
    expect(await svc.removeAll(admin, undefined, 'fyi')).toEqual({ deleted: 1 });
    expect((await svc.list(admin)).rows.map((r) => r.tier)).toEqual(['later']);
    await expect(svc.removeAll(admin, undefined, 'urgent')).rejects.toBeTruthy();
  });
  it('rows written before 0035 (no fold key) still show the new texts', async () => {
    const { repo, svc } = mk();
    await repo.record(entry({ id: 'old', code: 'LINK_OFF', status: 503, tier: 'now', at: '2026-10-13T09:00:00.000Z', message: 'The YS link sync token is not set' }));
    expect((await svc.list(admin)).rows[0]).toMatchObject({ id: 'old', tier: 'now', line1: 'The Elvanto link is off: no sync token in Vercel' });
  });

  // D1 (2026-10-24): link alerts clear themselves. Count rows (pending-24h, unclear, lease-lost) are live counts; every other
  // link row is an event and goes after 7 days or a later success of its type.
  describe('D1: link alerts clear themselves', () => {
    const NOW = new Date('2026-10-24T10:00:00Z');
    const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
    const box = async (link: InMemoryLinkRepository, id: string, type: string, status: string, o: { reason?: string; resultAt?: string } = {}) => {
      await link.insertAction({ id, type, payload: { personId: id }, note: null, dedupeKey: `k-${id}`, serviceDate: '2026-10-23',
        studentId: null, personId: id, createdBy: 'u', leaderId: null, leaderName: 'L' } as any);
      link._backdate('link_outbox', id, 'status', status);
      if (o.reason) link._backdate('link_outbox', id, 'reason', o.reason);
      if (o.resultAt) link._backdate('link_outbox', id, 'result_at', o.resultAt);
    };
    const linkRow = (id: string, code: string, route: string, at: string, foldKey: string | null = `link|${code}|${route}`) =>
      entry({ id, category: 'link', code, route, status: null, tier: 'later', foldKey, at });
    const of = (rows: { code: string; route: string }[], code: string, route: string) => rows.filter((r) => r.code === code && r.route === route);

    it('unclear link rows become a live count per type', async () => {
      const { repo, link, svc } = mk(NOW);
      await box(link, 'u1', 'checkIn', 'unclear');
      await box(link, 'u2', 'checkIn', 'unclear');
      await box(link, 'u3', 'completeStep', 'unclear', { reason: 'lease-lost' });
      await repo.record(linkRow('w1', 'unclear', 'checkIn', ago(2)));
      await repo.record(linkRow('w2', 'unclear', 'checkIn', ago(1)));
      const { rows } = await svc.list(admin);
      expect(of(rows, 'unclear', 'checkIn')).toMatchObject([{ count: 2, foldKey: null, line1: '2 check-in actions sent but Elvanto never confirmed them' }]);
      expect(of(rows, 'lease-lost', 'completeStep')).toMatchObject([{ count: 1, foldKey: null }]);
      expect(rows.filter((r) => r.code === 'unclear' || r.code === 'lease-lost')).toHaveLength(2);
    });
    it('a resolved unclear clears its count', async () => {
      const { link, svc } = mk(NOW);
      await box(link, 'u1', 'checkIn', 'unclear');
      await box(link, 'u2', 'checkIn', 'unclear');
      expect(of((await svc.list(admin)).rows, 'unclear', 'checkIn')).toHaveLength(1);
      for (const id of ['u1', 'u2']) link._backdate('link_outbox', id, 'status', 'sent');
      expect(of((await svc.list(admin)).rows, 'unclear', 'checkIn')).toEqual([]);
    });
    it('a link refusal expires after 7 days', async () => {
      const { repo, svc } = mk(NOW);
      await repo.record(linkRow('old', 'no-room', 'checkIn', ago(8)));
      await repo.record(linkRow('new', 'no-room', 'checkIn', ago(6)));
      expect((await svc.list(admin)).rows.map((r) => r.id)).toEqual(['new']);
    });
    it('a later success of the same type clears a type-wide refusal', async () => {
      const T = ago(1);
      const run = async (resultAt: string) => {
        const { repo, link, svc } = mk(NOW);
        await repo.record(linkRow('r', 'locked', 'consentFix', T));
        await box(link, 's1', 'consentFix', 'sent', { resultAt });
        return (await svc.list(admin)).rows.map((r) => r.id);
      };
      expect(await run(new Date(Date.parse(T) + 60_000).toISOString())).toEqual([]);
      expect(await run(new Date(Date.parse(T) - 60_000).toISOString())).toEqual(['r']);
    });
    it('ultra #4 (operator ruling A) + no-room ruling: a per-person refusal stays after a later success; a type-wide one clears', async () => {
      const T = ago(1), after = new Date(Date.parse(T) + 60_000).toISOString();
      const { repo, link, svc } = mk(NOW);
      // Finding 3 ruling: no-room is per person (no Demographic room, Elvanto's No room), so it stays too; locked still clears.
      for (const [id, code] of [['p', 'person-unknown'], ['f', 'unknown'], ['n', 'no-room'], ['l', 'locked']] as const) await repo.record(linkRow(id, code, 'checkIn', T));
      await box(link, 's1', 'checkIn', 'sent', { resultAt: after });
      expect((await svc.list(admin)).rows.map((r) => r.id).sort()).toEqual(['f', 'n', 'p']);
    });
        it('count rows never expire', async () => {
      const { repo, link, svc } = mk(NOW);
      const id = '9e000000-0000-4000-8000-000000000001';
      await box(link, id, 'checkIn', 'pending');
      link._backdate('link_outbox', id, 'created_at', ago(31));
      const old = makeErrorLogService({ repo, now: () => new Date(ago(30)) }); // written 30 days ago
      await old.record({ category: 'link', code: 'pending-24h', route: 'checkIn' }, 1);
      await old.record({ category: 'reconcile', code: 'recon-unmatched', route: '' }, 4);
      const rows = (await svc.list(admin)).rows;
      expect(rows.map((r) => [r.code, r.count, r.lastSeen]).sort()).toEqual([['pending-24h', 1, ago(30)], ['recon-unmatched', 4, ago(30)]]);
    });
    it('a pre-0035 refusal row (foldKey null) still expires', async () => {
      const { repo, svc } = mk(NOW);
      await repo.record(linkRow('pre', 'no-room', 'checkIn', ago(8), null));
      await repo.record(linkRow('preU', 'unclear', 'checkIn', ago(3), null)); // not the fixed id, nothing open
      expect((await svc.list(admin)).rows).toEqual([]);
    });
    it('the later-success read is bounded, and only for real action types', async () => {
      const repo = new InMemoryErrorLogRepository();
      const calls: unknown[] = [];
      const link = { listActions: async (f: unknown) => { calls.push(f); return []; } } as any;
      const svc = makeErrorLogService({ repo, link, now: () => NOW });
      await repo.record(linkRow('a', 'locked', 'checkIn', ago(2)));
      await repo.record(linkRow('b', 'locked', 'checkIn', ago(1)));
      await repo.record(entry({ id: 'c', category: 'link', code: 'INTERNAL', route: 'GET /link/intake/row', status: null, at: ago(1) }));
      await svc.sweep();
      expect(calls.filter((f: any) => f.statuses?.includes('sent'))).toEqual([{ types: ['checkIn'], statuses: ['sent'], serviceDateFrom: '2026-10-15', limit: 50 }]);
    });
    it('sweep() never throws', async () => {
      const repo = new InMemoryErrorLogRepository();
      const link = { listActions: async () => { throw new Error('db down'); } } as any;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(makeErrorLogService({ repo, link }).sweep()).resolves.toBeUndefined();
      warn.mockRestore();
    });
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
    expect(record).toHaveBeenCalledWith({ category: 'link', code: 'too-old', route: 'checkIn', role: 'console', count: 1 });
  });
  it('review fix: swept rows are written once per (type, reason) with their count, not one write per row', async () => {
    const { link, svc, record } = await setup();
    for (const n of [1, 2, 3]) link._backdate('link_outbox', id(n), 'created_at', new Date(Date.now() - 4 * DAY).toISOString());
    await svc.claim(claimReq);
    expect(record.mock.calls).toEqual([[{ category: 'link', code: 'too-old', route: 'checkIn', role: 'console', count: 3 }]]);
  });

  it('refused results are recorded once each; unclear (D1: the sweep counts it) and sent are not', async () => {
    const { svc, record } = await setup();
    await svc.claim({ ...claimReq, max: 6 });
    record.mockClear();
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [
      { id: id(1), outcome: 'refused', reason: 'person-unknown', detail: 'Sam Smith not found' },
      { id: id(2), outcome: 'unclear', sentLogKey: 'k2', detail: 'x' },
      { id: id(3), outcome: 'sent', sentLogKey: 'k3' },
    ] });
    expect(record.mock.calls).toEqual([
      [{ category: 'link', code: 'person-unknown', route: 'checkIn', role: 'console', count: 1 }],
    ]);
    // A replay of the same result is ignored by the repo, so it is not counted twice.
    record.mockClear();
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: id(1), outcome: 'refused', reason: 'person-unknown' }] });
    expect(record).not.toHaveBeenCalled();
  });
  it('R9: refused results with the same type and reason are one record with their count', async () => {
    const { svc, record } = await setup();
    await svc.claim({ ...claimReq, max: 6 });
    record.mockClear();
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [1, 2, 3].map((n) => ({ id: id(n), outcome: 'refused', reason: 'person-unknown' })) });
    expect(record.mock.calls).toEqual([[{ category: 'link', code: 'person-unknown', route: 'checkIn', role: 'console', count: 3 }]]);
  });
  it('T6: a refused or too-old addGroupMember lands in the log as category link', async () => {
    const { link, svc, record } = await setup();
    const payload = { groupId: '6a000000-0000-4000-8000-000000000001', personId: '9e000000-0000-4000-8000-000000000009' };
    for (const [n, type] of [[7, 'addGroupMember'], [8, 'removeGroupMember']] as const) {
      await link.insertAction({ id: id(n), type, payload, note: null, dedupeKey: dedupeKey(type, payload) + n,
        serviceDate: null, studentId: null, personId: payload.personId, createdBy: 'u', leaderId: null, leaderName: 'L' } as any);
    }
    link._backdate('link_outbox', id(8), 'created_at', new Date(Date.now() - 4 * DAY).toISOString());
    await svc.claim({ ...claimReq, max: 9, capabilities: { ...claimReq.capabilities, addGroupMember: 'live', removeGroupMember: 'live' } });
    expect(record).toHaveBeenCalledWith({ category: 'link', code: 'too-old', route: 'removeGroupMember', role: 'console', count: 1 });
    record.mockClear();
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: id(7), outcome: 'refused', reason: 'person-unknown' }] });
    expect(record).toHaveBeenCalledWith({ category: 'link', code: 'person-unknown', route: 'addGroupMember', role: 'console', count: 1 });
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
    await seedDemoData(repos, 'test-only-pass');
    // A route that crashes, to prove the adapter logs a 5xx (code + route + role, never the message).
    const routes = [...buildRoutes(services), { method: 'GET' as const, path: '/admin/boom', auth: true,
      handler: async () => { throw new Error('secret Sam Smith 0412345678'); } }];
    server = createApp(routes, services.auth, services.health, services.errorLog).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const u of ['admin', 'grade7']) {
      const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: u, password: 'test-only-pass' }) });
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

  it('r21 L6b (T9): POST /admin/reconcile/resend is admin only; a row not in the last check is a 400', async () => {
    const body = { kind: 'checkin', personId: '00000000-0000-4000-8000-000000000001', date: '2026-10-20' };
    expect((await call('POST', '/admin/reconcile/resend', undefined, body)).status).toBe(401);
    expect((await call('POST', '/admin/reconcile/resend', tokens['grade7'], body)).status).toBe(403);
    expect((await call('POST', '/admin/reconcile/resend', tokens['admin'], body)).status).toBe(400);
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
  it('DELETE /admin/errors?tier=fyi clears FYI rows only', async () => {
    await call('POST', '/admin/errors/client', tokens['grade7'], { kind: 'api', code: '', route: 'GET /students', status: 0 }); // NETWORK, fyi
    const before = (await j(await call('GET', '/admin/errors', tokens['admin']))).rows;
    const fyi = before.filter((r: any) => r.tier === 'fyi').length;
    expect(fyi).toBeGreaterThan(0);
    expect((await j(await call('DELETE', '/admin/errors?tier=fyi', tokens['admin']))).deleted).toBe(fyi);
    const after = (await j(await call('GET', '/admin/errors', tokens['admin']))).rows;
    expect(after.every((r: any) => r.tier !== 'fyi' && typeof r.line1 === 'string' && typeof r.line2 === 'string')).toBe(true);
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

describe('migration 0035', () => {
  it('widens the category check with reconcile and adds tier + fold_key, additive only', () => {
    const m = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0035_error_log_tier.sql'), 'utf8');
    expect(m).toMatch(/drop constraint if exists error_log_category_check/);
    expect(m).toMatch(/'reconcile'/);
    expect(m).toMatch(/add column if not exists tier text not null default 'later'/);
    expect(m).toMatch(/check \(tier in \('now','later','fyi'\)\)/);
    expect(m).toMatch(/add column if not exists fold_key text/);
    expect(m).toMatch(/create index if not exists error_log_fold_idx on error_log\(fold_key, last_seen\)/);
    expect(m).not.toMatch(/(drop table|drop column|alter column|rename)/i);
  });
});

describe('audit-feed-stale hook (spec 2026-10-22 §7)', () => {
  it('list() re-evaluates the audit feed before reading rows; a throwing check never breaks the list', async () => {
    const repo = new InMemoryErrorLogRepository();
    let calls = 0;
    const svc = makeErrorLogService({ repo, auditFeed: async () => {
      calls++;
      await repo.record(entry({ id: 'feed', category: 'audit', code: 'audit-feed-stale', route: '', status: null, tier: 'now',
        at: new Date().toISOString() }), 1);
    } });
    const { rows } = await svc.list(admin);
    expect(calls).toBe(1);
    expect(rows.find((r) => r.code === 'audit-feed-stale')).toMatchObject({ line1: "Connection Audit hasn't updated for over a week" });
    const bad = makeErrorLogService({ repo, auditFeed: async () => { throw new Error('x'); } });
    await expect(bad.list(admin)).resolves.toMatchObject({ rows: expect.any(Array) });
  });
});
