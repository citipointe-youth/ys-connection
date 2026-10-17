// reconcile.service run/rematch (spec 2026-10-17 §5.2; plan Part 2 task C2).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../utils/logger', () => {
  const nop = () => {};
  return { createLogger: () => ({ info: nop, warn: nop, error: nop }) };
});
import { makeReconcileService } from '../services/reconcile.service';
import { makeErrorLogService } from '../services/error-log.service';
import { InMemoryErrorLogRepository } from '../repositories/in-memory/error-log.repository';
import { InMemoryReconcileRunRepository } from '../repositories/in-memory/reconcile-run.repository';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryStudentRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import type { OutboxRow } from '../core/link-types';

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-23T11:20:00Z');            // Fri 23 Oct 9:20 pm Brisbane

async function harness(o: { actions?: Partial<OutboxRow>[]; throwIn?: 'lifegroups'; hang?: 'sessions' | 'roster'; budgetMs?: number } = {}) {
  const link = new InMemoryLinkRepository();
  await link.replaceMirror('roster', [
    { personId: P(1), firstName: 'Ava', lastName: 'Test', gender: 'female', grade: 9, kind: 'student' },
    { personId: P(2), firstName: 'Leo', lastName: 'Lead', gender: 'male', grade: null, kind: 'leader' },
  ], { takenAt: NOW.toISOString(), consoleId: P(99) });
  link.listActions = async () => (o.actions ?? []) as OutboxRow[];
  if (o.hang === 'roster') link.roster = () => new Promise(() => {});
  const students = new InMemoryStudentRepository(); await students.init();
  const settings = new InMemorySettingsRepository(); await settings.init();
  const errRepo = new InMemoryErrorLogRepository();
  const errorLog = makeErrorLogService({ repo: errRepo, now: () => NOW });
  const runs = new InMemoryReconcileRunRepository();
  const lifegroups = { findAll: async () => { if (o.throwIn === 'lifegroups') throw new Error('x'); return [{ id: 'lg1', elvantoGroupId: null, fullName: 'Grade 9 Girls' }] as any; },
    findRoll: async () => [] };
  const svc = makeReconcileService({ link, students, lifegroups, lifegroupWeeks: { findAll: async () => [] },
    lifegroupAttendance: { findAll: async () => [] }, serviceSessions: { findAll: () => (o.hang === 'sessions' ? new Promise(() => {}) : Promise.resolve([])) },
    serviceAttendance: { findBySession: async () => [] }, imports: { findByType: async () => [{ id: 'imp-1', importedAt: '2026-10-23T11:15:00Z' } as any] },
    settings, errorLog, errorRows: errRepo, runs, now: () => NOW, budgetMs: o.budgetMs });
  return { svc, errRepo, runs, students, link };
}
const codes = async (r: InMemoryErrorLogRepository) => Object.fromEntries((await r.list()).map((x) => [x.code + (x.route ? `:${x.route}` : ''), x.count]));

describe('reconcile.run', () => {
  it('writes one entry per non-zero check with setCount, and a run row with ids only', async () => {
    const { svc, errRepo, runs } = await harness();
    await svc.run();
    expect(await codes(errRepo)).toEqual({ 'recon-unmatched': 1, 'recon-lifegroup-noid': 1 });
    const run = (await runs.latest())!;
    expect(run.ok).toBe(true);
    expect(run.importId).toBe('imp-1');
    expect(run.checks).toEqual({ checkins: { count: 0 }, unmatched: { count: 1 }, lifegroups: { count: 0, noId: 1 }, members: { count: 0 } });
    expect(JSON.stringify(run)).not.toMatch(/Ava|Test|Leo/);
  });
  it('rematch runs first: a new student is matched before check 2, and zero deletes the row', async () => {
    const { svc, errRepo, students } = await harness();
    await svc.run();
    await students.save({ id: 's1', firstName: 'Ava', lastName: 'Test', gender: 'female', grade: 9 } as any);
    await svc.run();
    expect(await codes(errRepo)).toEqual({ 'recon-lifegroup-noid': 1 });
  });
  it('a throwing check gives recon-failed and ok=false; other checks still run', async () => {
    const { svc, errRepo, runs } = await harness({ throwIn: 'lifegroups' });
    await svc.run();
    const c = await codes(errRepo);
    expect(c['recon-failed:lifegroups']).toBe(1);
    expect(c['recon-unmatched']).toBe(1);
    const run = (await runs.latest())!;
    expect(run.ok).toBe(false);
    expect(run.checks.lifegroups).toEqual({ error: true });
  });
  it('never throws, even when the run store fails', async () => {
    const { svc, runs } = await harness();
    runs.save = async () => { throw new Error('db'); };
    await expect(svc.run()).resolves.toBeUndefined();
  });
  it('budget bounds the whole run: a hanging check is cut off, recorded as recon-failed, ok=false', async () => {
    const { svc, errRepo, runs } = await harness({ hang: 'sessions', budgetMs: 50 });
    const t = Date.now();
    await svc.run();
    expect(Date.now() - t).toBeLessThan(500);
    expect((await codes(errRepo))['recon-failed:checkins']).toBe(1);
    const run = (await runs.latest())!;
    expect(run.ok).toBe(false);
    expect(run.checks.checkins).toEqual({ error: true });
    expect(run.checks.unmatched).toEqual({ count: 1 });
  });
  it('budget covers the steps before the checks: a hanging roster read still ends the run in time', async () => {
    const { svc, errRepo, runs } = await harness({ hang: 'roster', budgetMs: 50 });
    const t = Date.now();
    await svc.run();
    expect(Date.now() - t).toBeLessThan(500);
    const c = await codes(errRepo);
    for (const k of ['checkins', 'unmatched', 'lifegroups', 'members']) expect(c[`recon-failed:${k}`]).toBe(1);
    expect((await runs.latest())!.ok).toBe(false);
  });
});

describe('reconcile.latest (console endpoint)', () => {
  const body = { contractVersion: 1, consoleId: P(99) };
  it('shape: run + entries, tier now/later only, ignored left out, 7-day filter for non-reconcile rows', async () => {
    const { svc, errRepo } = await harness();
    await svc.run();
    const old = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    await errRepo.record({ id: 'old1', category: 'link', code: 'unclear', route: 'checkIn', status: null, message: 'x', role: null, at: old, tier: 'now', foldKey: null } as any);
    await errRepo.record({ id: 'fyi1', category: 'server', code: 'SERVICE_UNAVAILABLE', route: '', status: 503, message: 'x', role: null, at: NOW.toISOString(), tier: 'fyi', foldKey: null } as any);
    await errRepo.record({ id: 'ign1', category: 'link', code: 'unclear', route: 'consentSave', status: null, message: 'x', role: null, at: NOW.toISOString(), tier: 'now', foldKey: null } as any);
    await errRepo.setFlags('ign1', { ignored: true });
    const r = await svc.latest(body);
    expect(r.run?.ok).toBe(true);
    expect(r.entries.map((e) => e.code).sort()).toEqual(['recon-lifegroup-noid', 'recon-unmatched']);
    expect(r.entries.find((e) => e.code === 'recon-unmatched')).toMatchObject({ tier: 'later', count: 1 });
    expect(r.entries.find((e) => e.code === 'recon-unmatched')).toMatchObject({ counted: true, line1: '1 roster student has no student record in YS' });
  });
  it('persistent reconcile row older than 7 days is kept', async () => {
    const { svc, errRepo } = await harness();
    await svc.run();
    const real = errRepo.list.bind(errRepo);   // age every row by 22 days
    errRepo.list = async () => (await real()).map((x) => ({ ...x, lastSeen: '2026-10-01T00:00:00.000Z' }));
    expect((await svc.latest(body)).entries.map((e) => e.code)).toContain('recon-unmatched');
  });
  it('wrong contract version is a 409 LinkContractMismatch', async () => {
    const { svc } = await harness();
    await expect(svc.latest({ ...body, contractVersion: 2 })).rejects.toMatchObject({ code: 'LINK_CONTRACT_MISMATCH' });
  });
  it('no run yet gives run null', async () => {
    const { svc } = await harness();
    expect((await svc.latest(body)).run).toBeNull();
  });
});

describe('reconcile.whoLatest', () => {
  const ADMIN = { id: 'u-admin', role: 'admin', displayName: 'A', grade: null, quad: null } as any;
  const LEADER = { id: 'u-l', role: 'leader', displayName: 'L', grade: 9, quad: null } as any;
  it('resolves ids to names at read time', async () => {
    const { svc } = await harness();
    await svc.run();
    const w = await svc.whoLatest(ADMIN);
    expect(w.unmatched).toEqual([{ name: 'Ava Test', grade: 9 }]);
    expect(w.noId).toEqual(['Grade 9 Girls']);
    expect(w.ok).toBe(true);
  });
  it('refuses a non-admin', async () => {
    const { svc } = await harness();
    await expect(svc.whoLatest(LEADER)).rejects.toBeTruthy();
  });
  it('no run gives empty sections', async () => {
    const { svc } = await harness();
    expect(await svc.whoLatest(ADMIN)).toEqual({ ranAt: null, ok: null, checkins: [], unmatched: [], lifegroups: [], members: [], noId: [] });
  });
});
