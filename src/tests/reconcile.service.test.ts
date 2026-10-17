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

async function harness(o: { actions?: Partial<OutboxRow>[]; throwIn?: 'lifegroups' } = {}) {
  const link = new InMemoryLinkRepository();
  await link.replaceMirror('roster', [
    { personId: P(1), firstName: 'Ava', lastName: 'Test', gender: 'female', grade: 9, kind: 'student' },
    { personId: P(2), firstName: 'Leo', lastName: 'Lead', gender: 'male', grade: null, kind: 'leader' },
  ], { takenAt: NOW.toISOString(), consoleId: P(99) });
  link.listActions = async () => (o.actions ?? []) as OutboxRow[];
  const students = new InMemoryStudentRepository(); await students.init();
  const settings = new InMemorySettingsRepository(); await settings.init();
  const errRepo = new InMemoryErrorLogRepository();
  const errorLog = makeErrorLogService({ repo: errRepo, now: () => NOW });
  const runs = new InMemoryReconcileRunRepository();
  const lifegroups = { findAll: async () => { if (o.throwIn === 'lifegroups') throw new Error('x'); return [{ id: 'lg1', elvantoGroupId: null }] as any; },
    findRoll: async () => [] };
  const svc = makeReconcileService({ link, students, lifegroups, lifegroupWeeks: { findAll: async () => [] },
    lifegroupAttendance: { findAll: async () => [] }, serviceSessions: { findAll: async () => [] },
    serviceAttendance: { findBySession: async () => [] }, imports: { findByType: async () => [{ id: 'imp-1', importedAt: '2026-10-23T11:15:00Z' } as any] },
    settings, errorLog, errorRows: errRepo, runs, now: () => NOW });
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
});
