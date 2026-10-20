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
  it('legacy A12 (recon C3): one oversized row is clipped, not a 500 for the whole answer', async () => {
    const { svc, errRepo } = await harness();
    await svc.run();
    await errRepo.record({ id: 'big1', category: 'link', code: 'X'.repeat(100), route: 'checkIn', status: null, message: 'y'.repeat(400), role: null, at: NOW.toISOString(), tier: 'now', foldKey: null } as any);
    const r = await svc.latest(body);
    expect(r.entries.map((e) => e.code)).toContain('recon-unmatched');
    expect(r.entries.every((e) => e.code.length <= 80 && e.line1.length <= 300)).toBe(true);
    expect(r.entries.some((e) => e.code.startsWith('XXX'))).toBe(true);
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

describe('container wiring (C5)', () => {
  it('a groups import runs reconcile through the container hook', async () => {
    const { buildContainer } = await import('../container');
    const c = await buildContainer();
    const DIRECTOR = { id: 'dir', role: 'director', displayName: 'Dir', grade: null, quad: null } as any;
    await c.services.importService.importGroupCsv(DIRECTOR, { groups: [{ name: 'Grade 9 Girls', meetings: ['2026-10-20'],
      members: [{ first_name: 'Ava', last_name: 'Test', attendance: [true] }] }] }, 'g.csv');
    const r = await c.services.reconcile.latest({ contractVersion: 1, consoleId: P(99) });
    expect(r.run).not.toBeNull();
    expect(r.run!.checks.lifegroups).toEqual({ count: 0, noId: 1 });   // no link_groups pushed -> no id
  });
});

// r21 L6b (T9): "Send again" on a Who? row re-queues the same outbox type. Only an item of the latest run; the console reads
// Elvanto first (checked in / in the group = already, nothing sent), so a send that did land is never written twice.
describe('reconcile.resend', () => {
  const ADMIN = { id: 'u-admin', role: 'admin', displayName: 'A', grade: null, quad: null } as any;
  const LEADER = { id: 'u-l', role: 'leader', displayName: 'L', grade: 9, quad: null } as any;
  const G = P(50), ST = P(60), SVC = P(61), R1 = P(70), DAY = '2026-10-20';
  const sent = (o: Partial<OutboxRow>) => ({ id: P(Math.floor(Math.random() * 1e6) + 1000), status: 'sent', resultAt: '2026-10-21T00:00:00.000Z',
    note: null, hasNote: false, studentId: 's1', personId: P(1), leaderId: 'L1', leaderName: 'Dana Day', createdBy: 'u-l', reportId: null, ...o }) as OutboxRow;
  const CHECK = sent({ type: 'checkIn', serviceDate: DAY, payload: { serviceTimeId: ST, serviceId: SVC, personId: P(1) } });
  const ADD = sent({ type: 'addGroupMember', serviceDate: DAY, payload: { groupId: G, personId: P(1) } });
  const REP = sent({ type: 'submitReport', serviceDate: DAY, reportId: R1, payload: { groupId: G, date: DAY, didNotMeet: false, attendees: [P(1)], guests: 0, notesPrivate: false, serviceTimeId: null } });
  const report = { reportId: R1, date: DAY, time: '6:30 PM', didNotMeet: false, attendees: [], guests: 0, serviceTimeId: null, editable: true, blocked: null };
  async function setup(o: { lastReport?: unknown } = {}) {
    const h = await harness({ actions: [CHECK, ADD, REP] });
    await h.link.replaceMirror('groups', [{ groupId: G, name: 'Grade 9 Girls', grade: 9, gender: 'female', meets: 'Tue 6:30 PM',
      members: [{ personId: P(1), name: 'Ava Test', leader: false }], thisWeek: 'reported', lastReport: 'lastReport' in o ? o.lastReport : report, history: [] }],
      { takenAt: NOW.toISOString(), consoleId: P(99) });
    await h.runs.save({ id: 'run1', ranAt: NOW.toISOString(), importId: 'imp-1', ok: true,
      checks: { checkins: { count: 1 }, unmatched: { count: 0 }, lifegroups: { count: 1, noId: 0 }, members: { count: 1 } },
      items: { checkins: [{ personId: P(1), date: DAY }], unmatched: [], lifegroups: [{ groupId: G, date: DAY, personIds: [P(1)] }], noId: [],
        members: [{ groupId: G, personId: P(1), op: 'add' }] } } as any);
    const queued = async () => [...(h.link as any).outbox.values()].map((e: any) => e.row);
    return { ...h, queued };
  }

  it('whoLatest rows carry the ids Send again needs', async () => {
    const h = await setup();
    const w = await h.svc.whoLatest(ADMIN);
    expect(w.checkins[0]).toMatchObject({ personId: P(1), date: DAY });
    expect(w.lifegroups[0]).toMatchObject({ groupId: G, date: DAY });
    expect(w.members[0]).toMatchObject({ groupId: G, personId: P(1), op: 'add' });
  });
  it('a check-in: a new checkIn row with the sent payload, no note, made by the admin; a second tap while it waits is a duplicate', async () => {
    const h = await setup();
    expect(await h.svc.resend(ADMIN, { kind: 'checkin', personId: P(1), date: DAY })).toEqual({ ok: true, type: 'checkIn' });
    const [row] = await h.queued();
    expect(row).toMatchObject({ type: 'checkIn', status: 'pending', payload: CHECK.payload, note: null, createdBy: 'u-admin', serviceDate: DAY,
      personId: P(1), dedupeKey: `checkIn:${ST}:${P(1)}` });
    expect(row.id).not.toBe(CHECK.id);
    await expect(h.svc.resend(ADMIN, { kind: 'checkin', personId: P(1), date: DAY })).rejects.toMatchObject({ code: 'LINK_DUPLICATE' });
  });
  it('review fix 5: a check-in that went as firstTimerCheckIn is sent again as a plain checkIn of that person', async () => {
    const h = await setup();
    const FT = sent({ type: 'firstTimerCheckIn', serviceDate: DAY, personId: P(1),
      payload: { serviceTimeId: ST, serviceId: SVC, firstName: 'Ava', lastName: 'Test', grade: 9, gender: 'female' } });
    h.link.listActions = async () => [FT] as OutboxRow[];
    expect(await h.svc.resend(ADMIN, { kind: 'checkin', personId: P(1), date: DAY })).toEqual({ ok: true, type: 'checkIn' });
    expect((await h.queued())[0]).toMatchObject({ type: 'checkIn', payload: { serviceTimeId: ST, serviceId: SVC, personId: P(1) } });
  });
  it('a member change: the same type again', async () => {
    const h = await setup();
    expect(await h.svc.resend(ADMIN, { kind: 'member', groupId: G, personId: P(1), op: 'add' })).toEqual({ ok: true, type: 'addGroupMember' });
    expect((await h.queued())[0]).toMatchObject({ type: 'addGroupMember', payload: { groupId: G, personId: P(1) } });
  });
  it('a lifegroup report in Elvanto: an editReport of that report, base = what Elvanto has (the groups mirror)', async () => {
    const h = await setup();
    expect(await h.svc.resend(ADMIN, { kind: 'lifegroup', groupId: G, date: DAY })).toEqual({ ok: true, type: 'editReport' });
    expect((await h.queued())[0]).toMatchObject({ type: 'editReport', note: null, leaderName: 'Dana Day', payload: { ...REP.payload, reportId: R1,
      base: { date: DAY, didNotMeet: false, attendees: [], guests: 0, serviceTimeId: null } } });
  });
  it('a lifegroup report Elvanto does not have: submitReport again; one Elvanto will not let the app edit is refused', async () => {
    const h = await setup({ lastReport: null });
    expect(await h.svc.resend(ADMIN, { kind: 'lifegroup', groupId: G, date: DAY })).toEqual({ ok: true, type: 'submitReport' });
    expect((await h.queued())[0]).toMatchObject({ type: 'submitReport', payload: REP.payload });
    const b = await setup({ lastReport: { ...report, editable: false, blocked: 'multi-service' } });
    await expect(b.svc.resend(ADMIN, { kind: 'lifegroup', groupId: G, date: DAY })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('refuses: not admin, not in the latest run, a bad body, the console has the type off', async () => {
    const h = await setup();
    await expect(h.svc.resend(LEADER, { kind: 'checkin', personId: P(1), date: DAY })).rejects.toBeTruthy();
    await expect(h.svc.resend(ADMIN, { kind: 'checkin', personId: P(2), date: DAY })).rejects.toMatchObject({ statusCode: 400 });
    await expect(h.svc.resend(ADMIN, { kind: 'nope' })).rejects.toMatchObject({ statusCode: 400 });
    h.link.listConsoles = async () => [{ consoleId: P(99), lastSeenAt: NOW.toISOString(), capabilities: { checkIn: 'off' } } as any];
    await expect(h.svc.resend(ADMIN, { kind: 'checkin', personId: P(1), date: DAY })).rejects.toMatchObject({ code: 'LINK_UNAVAILABLE' });
    expect(await h.queued()).toEqual([]);
  });
});
