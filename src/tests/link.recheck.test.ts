// L7 (round 2026-10-21, LINK_REV 15): "Check again" on an unclear save. The admin asks the console to re-run that save's own
// read/confirm check (read only); the console answers the recheck row (already = saved, refused not-landed = not saved,
// any other refusal = still unclear) and posts `resolved` on the unclear row itself when it knows.
import { describe, it, expect } from 'vitest';
import { makeLinkService, LINK_RATE_MAX, LINK_RATE_WINDOW_MS } from '../services/link.service';
import { makeSyncService } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { brisbaneElvanto } from './helpers/brisbane-elvanto';
import { RateLimiter } from '../utils/rate-limiter';
import type { Actor } from '../core/entities/user';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-16T09:00:00.000Z');
const T0 = '2026-10-01T00:00:00.000Z';
const ADMIN_ID = u(1), DIR_ID = u(2), L_DANA = u(301), CONSOLE = u(601);
const P_OK = u(102), FLOW = u(511), STEP1 = u(521), FR_OK = u(502);
const actor = (id: string, role: string): Actor =>
  ({ id, role: role as Actor['role'], displayName: `${role} login`, grade: null, quad: null, gender: null, leaderId: null });
const ADMIN = actor(ADMIN_ID, 'admin'), DIRECTOR = actor(DIR_ID, 'director');
let idn = 9000;
const nid = () => u(++idn);
const CAPS = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live',
  removeFromFlowStep: 'live', consentLookup: 'live', consentFix: 'live', consentLink: 'live', recheck: 'live' } as Record<string, string>;
const { recheck: _r, ...OLD_CAPS } = CAPS; // a rev 14 console lists no recheck

async function setup() {
  const link = new InMemoryLinkRepository({ now: () => NOW });
  const settings = new InMemorySettingsRepository(), students = new InMemoryStudentRepository(), leaders = new InMemoryLeaderRepository();
  const users = new InMemoryUserRepository(), sessions = new InMemoryServiceSessionRepository(), attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, students, leaders, users, sessions, attendance]) await r.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, elvanto: brisbaneElvanto(),
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, flows: 'on', intakeAdmin: 'on' } } } as never);
  for (const [id, email, role] of [[ADMIN_ID, 'admin', 'admin'], [DIR_ID, 'director', 'director']] as const) {
    await users.save({ id, email, displayName: `${email} name`, role, status: 'active', createdAt: T0, updatedAt: T0 } as never);
  }
  await leaders.save({ id: L_DANA, fullName: 'Dana Day', gender: 'female', grades: [8, 9], active: true, createdByGrade: null,
    smsTemplate: null, createdAt: T0, updatedAt: T0 } as never);
  await link.replaceMirror('flows', [{ rowId: FR_OK, flowId: FLOW, flowName: 'Follow up', stepId: STEP1, stepName: 'Call', stepOrder: 2,
    personId: P_OK, name: 'Sample Kid', due: null, assignedTo: '', grade: 8, gender: 'female', mobile: '0400000001', mobileIsParent: false,
    consent: 'ok' }] as never, { takenAt: '2026-10-16T08:00:00.000Z', consoleId: CONSOLE });
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: new RateLimiter(LINK_RATE_MAX, LINK_RATE_WINDOW_MS), now: () => NOW });
  const recorded: { code: string; route: string }[] = [];
  const errorLog = { record: async (e: { code: string; route: string }) => { recorded.push(e); } };
  const sync = makeSyncService({ link, settings, students, users, now: () => NOW, errorLog: errorLog as never });
  const claim = (caps: Record<string, string> = CAPS, max = 20) => sync.claim({ contractVersion: 1, consoleId: CONSOLE, consoleLabel: 'PC',
    consoleVersion: '1', inWindow: false, pollSeconds: 60, capabilities: caps, max, leaseSeconds: 300, linkRev: 15 });
  const result = (results: object[]) => sync.result({ contractVersion: 1, consoleId: CONSOLE, results });
  // One unclear completeStep with a note (the leader's "I am" is Dana).
  const a = { kind: 'action', id: nid(), type: 'completeStep', payload: { rowId: FR_OK, flowId: FLOW, stepId: STEP1, personId: P_OK, notePrivate: false },
    note: 'Called mum.', leaderId: L_DANA };
  const r0 = (await svc.batch(ADMIN, { device: { id: 'dev-1', label: 't' }, items: [a] })).results[0]!;
  expect(r0.outcome).toBe('saved');
  const first = await claim();
  const orig = first.rows.find((r) => r.id === a.id)!;
  await result([{ id: a.id, outcome: 'unclear', sentLogKey: `complete:ys:${FR_OK}` }]);
  recorded.length = 0; // the unclear row's own Error log line
  return { link, svc, sync, claim, result, a, orig, recorded };
}

describe('L7: POST /link/admin/unclear/:id/recheck queues a recheck row', () => {
  it('admin only; the row must be unclear; one open re-check per row', async () => {
    const h = await setup();
    await expect(h.svc.recheckUnclear(DIRECTOR, h.a.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(h.svc.recheckUnclear(ADMIN, u(8999))).rejects.toMatchObject({ statusCode: 404 });
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    expect((await h.svc.recheckUnclear(ADMIN, h.a.id)).id).toBe(id); // the open one again, not a second
    expect(await h.svc.recheckState(ADMIN, id)).toEqual({ id, ref: h.a.id, state: 'checking', text: 'Checking Elvanto…' });
    await h.svc.resolveUnclear(ADMIN, h.a.id, { landed: true });
    await expect(h.svc.recheckUnclear(ADMIN, h.a.id)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('a console that lists no recheck (rev 14) never gets one: refused LINK_UNAVAILABLE, nothing queued', async () => {
    const h = await setup();
    await h.claim(OLD_CAPS, 0);
    await expect(h.svc.recheckUnclear(ADMIN, h.a.id)).rejects.toMatchObject({ statusCode: 409, code: 'LINK_UNAVAILABLE' });
  });
  it('an intake row is not re-checkable (400)', async () => {
    const h = await setup();
    const row = await h.link.getAction(h.a.id);
    await h.link.insertAction({ id: u(7001), type: 'intakeSave', payload: { date: '2026-10-16', row: u(7002), confirmed: ['k'], one: true },
      note: null, dedupeKey: 'is:x', serviceDate: '2026-10-16', studentId: null, personId: null, createdBy: ADMIN_ID, leaderId: null, leaderName: row!.leaderName });
    await h.claim({ ...CAPS, intakeSave: "live" });
    await h.result([{ id: u(7001), outcome: 'unclear', sentLogKey: 'k' }]);
    await expect(h.svc.recheckUnclear(ADMIN, u(7001))).rejects.toMatchObject({ statusCode: 400 });
  });
  it('the claim hands the recheck row the ref row type, payload, key and its note as the console first got it', async () => {
    const h = await setup();
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    const row = (await h.claim()).rows.find((r) => r.id === id)!;
    expect(row.type).toBe('recheck');
    expect(row.payload).toEqual({ ref: h.a.id, type: 'completeStep', payload: h.orig.payload, sentLogKey: `complete:ys:${FR_OK}` });
    expect(row.note).toBe(h.orig.note); // "Self identified leader: Dana Day — Called mum."
    expect(row.by.leaderName).toBe('Dana Day');
  });
  it('a recheck row is not something a phone can queue, and never shows in the action lists', async () => {
    const h = await setup();
    const r = (await h.svc.batch(ADMIN, { device: { id: 'dev-1', label: 't' }, items: [{ kind: 'action', id: nid(), type: 'recheck',
      payload: { ref: h.a.id, type: 'completeStep', payload: {}, sentLogKey: null }, note: null, leaderId: null }] })).results[0]!;
    expect(r.outcome).toBe('refused');
    await h.svc.recheckUnclear(ADMIN, h.a.id);
    expect((await h.svc.listActions(ADMIN, { serviceDate: '2026-10-16' })).map((x) => x.type)).not.toContain('recheck');
  });
});

describe('L7: the console answer', () => {
  it('saved: recheck already + resolved landed -> the unclear row is Saved; no Error log line', async () => {
    const h = await setup();
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    await h.claim();
    await h.result([{ id: h.a.id, outcome: 'resolved', landed: true }, { id, outcome: 'already' }]);
    expect(await h.link.getAction(h.a.id)).toMatchObject({ status: 'sent' });
    expect(await h.svc.recheckState(ADMIN, id)).toMatchObject({ state: 'saved', text: 'Saved in Elvanto.' });
    expect(h.recorded).toEqual([]);
  });
  it('not saved: refused not-landed -> Not saved, the unclear row is refused not-landed (send it again)', async () => {
    const h = await setup();
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    await h.claim();
    await h.result([{ id: h.a.id, outcome: 'resolved', landed: false }, { id, outcome: 'refused', reason: 'not-landed' }]);
    expect(await h.link.getAction(h.a.id)).toMatchObject({ status: 'refused', reason: 'not-landed' });
    expect(await h.svc.recheckState(ADMIN, id)).toMatchObject({ state: 'not-saved', text: 'Not saved in Elvanto. Send it again from the app if it is still needed.' });
    expect(h.recorded).toEqual([]); // the re-check itself is never an Error log line
  });
  it('still unclear: any other refusal keeps the row unclear and says why, then Landed / Not landed', async () => {
    const h = await setup();
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    await h.claim();
    await h.result([{ id, outcome: 'refused', reason: 'console-cannot-read', detail: "The console couldn't read Elvanto." }]);
    expect(await h.link.getAction(h.a.id)).toMatchObject({ status: 'unclear' });
    expect(await h.svc.recheckState(ADMIN, id)).toMatchObject({ state: 'unclear',
      text: "Still unclear: The console couldn't read Elvanto. Check it in Elvanto, then tap Landed or Not landed." });
    expect(h.recorded).toEqual([]);
    // and the admin may ask again
    expect((await h.svc.recheckUnclear(ADMIN, h.a.id)).id).not.toBe(id);
  });
  it('fix 2: a dead re-check (unclear, e.g. lease-lost) is never handed back: Check again queues a new one', async () => {
    const h = await setup();
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    await h.claim();
    await h.result([{ id, outcome: 'unclear', sentLogKey: 'x' }]); // as a lease-lost sweep leaves it
    const again = await h.svc.recheckUnclear(ADMIN, h.a.id);
    expect(again.id).not.toBe(id);
    expect((await h.link.getAction(id))!.status).toBe('cancelled'); // final, so its dedupe key is free
    expect((await h.svc.recheckState(ADMIN, id)).state).toBe('unclear'); // a dead check never reads Not saved
    expect((await h.link.getAction(again.id))!.status).toBe('pending');
    const claimed = await h.svc.recheckUnclear(ADMIN, h.a.id);
    expect(claimed.id).toBe(again.id); // a live (pending) one is reused
  });
  it('fix 2: a swept (too-old) re-check writes no Error log line', async () => {
    const h = await setup();
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    (h.link as unknown as { outbox: Map<string, { row: { createdAt: string } }> }).outbox.get(id)!.row.createdAt = '2026-10-01T00:00:00.000Z';
    await h.claim();
    expect((await h.link.getAction(id))!.reason).toBe('too-old');
    expect(h.recorded).toEqual([]);
  });
  it('recheckState: admin only, 404 for an unknown or non-recheck id', async () => {
    const h = await setup();
    const { id } = await h.svc.recheckUnclear(ADMIN, h.a.id);
    await expect(h.svc.recheckState(DIRECTOR, id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(h.svc.recheckState(ADMIN, h.a.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(h.svc.recheckState(ADMIN, 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});
