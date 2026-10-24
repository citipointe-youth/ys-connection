// Rev 20 (2026-10-25): the door's "Slow: Search Elvanto" (type doorSearch + push kind doorSearch). Server side.
import { describe, it, expect } from 'vitest';
import { makeLinkService } from '../services/link.service';
import { makeSyncService } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { Capabilities } from '../core/link-types';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-16T09:00:00.000Z'); // Friday 19:00 Brisbane
const T0 = '2026-10-01T00:00:00.000Z';
const GRADE_ID = u(4), GRADE2_ID = u(6), CONSOLE = u(601), OTHER_CONSOLE = u(602);
const ST = u(201), SVC = u(211), ROOM = u(221), P_AMY = u(101), P_SAM = u(150), P_SAMUEL = u(151);
const actor = (id: string, o: Partial<Actor>): Actor =>
  ({ id, role: 'grade', displayName: 'grade login', grade: null, quad: null, gender: null, leaderId: null, ...o } as Actor);
const GRADE = actor(GRADE_ID, { grade: 9, gender: 'female' });
const GRADE2 = actor(GRADE2_ID, { grade: 9, gender: 'male' });
const CAPS: Capabilities = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live',
  firstTimerCheckIn: 'live', doorSearch: 'live' };
let idn = 9500;
const nid = () => u(++idn);

async function setup(o: { caps?: Partial<Capabilities>; checkin?: 'on' | 'off' | 'admin' } = {}) {
  const now = () => NOW;
  const link = new InMemoryLinkRepository({ now });
  const settings = new InMemorySettingsRepository(), students = new InMemoryStudentRepository(), leaders = new InMemoryLeaderRepository();
  const users = new InMemoryUserRepository(), sessions = new InMemoryServiceSessionRepository(), attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, students, leaders, users, sessions, attendance]) await r.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, checkin: o.checkin ?? 'on' } } } as never);
  for (const [id, email] of [[GRADE_ID, 'grade9g'], [GRADE2_ID, 'grade9b']] as const) {
    await users.save({ id, email, displayName: email, role: 'grade', status: 'active', createdAt: T0, updatedAt: T0 } as never);
  }
  const meta = (takenAt: string) => ({ takenAt, consoleId: CONSOLE });
  await link.replaceMirror('roster', [{ personId: P_AMY, firstName: 'Amy', lastName: 'Adams', gender: 'female', grade: 9, kind: 'student' }], meta('2026-10-16T08:00:00.000Z'));
  await link.replaceMirror('services', [{ serviceTimeId: ST, serviceId: SVC, name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16',
    rooms: [{ id: ROOM, name: 'Youth Program' }], checkedIn: [] }], meta('2026-10-16T08:00:00.000Z'));
  const caps = { ...CAPS, ...o.caps } as Capabilities;
  for (const k of Object.keys(caps) as (keyof Capabilities)[]) if (caps[k] === undefined) delete caps[k];
  const claim = (max: number, consoleId = CONSOLE) => link.claim({ console: { consoleId, label: 'PC', contractVersion: 1, consoleVersion: '1',
    inWindow: true, pollSeconds: 10, capabilities: caps, linkRev: 20 }, max, leaseSeconds: 180, cutoffDays: 3, leaseLostMs: 3_600_000 });
  await claim(0);
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: { isBlocked: () => false }, now });
  const sync = makeSyncService({ link, settings, students, users, now });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const one = async (who: Actor, item: unknown): Promise<any> =>
    (await svc.batch(who, { device: { id: 'd', label: 'p' }, sentAt: NOW.toISOString(), items: [item] })).results[0]!;
  return { link, svc, sync, claim, one };
}
const search = (q: string | null) => { const id = nid(); return { kind: 'action', id, type: 'doorSearch', payload: { ref: id }, note: q, leaderId: null }; };
const checkIn = (personId: string) => ({ kind: 'action', id: nid(), type: 'checkIn', payload: { serviceTimeId: ST, serviceId: SVC, personId }, note: null, leaderId: null });
const pushBody = (requestId: string, rows: unknown[], consoleId = CONSOLE) =>
  ({ contractVersion: 1, consoleId, takenAt: '2026-10-16T09:00:20.000Z', requestId, rows });
const SAM = { personId: P_SAM, firstName: 'Sam', lastName: 'Sample', gender: 'female', grade: 9 };
const SAMUEL = { personId: P_SAMUEL, firstName: 'Samuel', lastName: 'Sample', gender: 'male', grade: null };

describe('rev 20 door search: queue (any check-in login, not admin-gated)', () => {
  it('a grade login queues it; the name stays in the note (2-60 characters); ref must be its own id', async () => {
    const h = await setup();
    const s = search('Sam Sample');
    expect((await h.one(GRADE, s)).outcome).toBe('saved');
    expect(await h.link.getAction(s.id)).toMatchObject({ type: 'doorSearch', status: 'pending', hasNote: true, payload: { ref: s.id } });
    for (const bad of [search('S'), search(null), search('x'.repeat(61)), { ...search('Sam'), payload: { ref: nid() } }]) {
      expect((await h.one(GRADE, bad)).outcome).toBe('refused');
    }
  });
  it("a newer search supersedes the same login's pending one; another login's is untouched; a claimed one is left to run", async () => {
    const h = await setup();
    const a = search('Sam'), other = search('Sam'), b = search('Samuel');
    await h.one(GRADE, a); await h.one(GRADE2, other); await h.one(GRADE, b);
    expect(await h.link.getAction(a.id)).toMatchObject({ status: 'cancelled', detail: `cancelled-by:${b.id}` });
    expect(await h.link.getAction(other.id)).toMatchObject({ status: 'pending' });
    await h.claim(20);
    expect((await h.one(GRADE, search('Sammy'))).outcome).toBe('saved');
    expect(await h.link.getAction(b.id)).toMatchObject({ status: 'claimed' });
  });
  it('refused while the newest console does not list doorSearch (an older console), and while the check-in screen is off', async () => {
    const h = await setup({ caps: { doorSearch: undefined } });
    expect((await h.one(GRADE, search('Sam'))).code).toBe('LINK_UNAVAILABLE');
    const off = await setup({ checkin: 'off' });
    await expect(off.one(GRADE, search('Sam'))).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
});

describe("rev 20 door search: the console's answer", () => {
  it('hit: the push adds the youth as active students, the door lists them (grade + gender) and a check-in is accepted', async () => {
    const h = await setup();
    const s = search('Sam');
    await h.one(GRADE, s);
    const [row] = await h.claim(20);
    expect(row!.row).toMatchObject({ id: s.id, type: 'doorSearch', note: 'Sam' });
    expect((await h.one(GRADE, checkIn(P_SAM))).outcome).toBe('refused'); // not on the list yet
    expect(await h.sync.push('doorSearch', pushBody(s.id, [SAM, SAMUEL]))).toEqual({ applied: true, rows: 2 });
    expect(await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: s.id, outcome: 'planned' }] })).toMatchObject({ applied: [s.id] });
    expect((await h.svc.listActions(GRADE, { ids: s.id }))[0]).toMatchObject({ status: 'sent' });
    const people = (await h.svc.checkin(GRADE, ST)).people!;
    expect(people.filter((p) => /Sam/.test(p.name)).map((p) => [p.name, p.grade, p.gender]))
      .toEqual([['Sam Sample', 9, 'female'], ['Samuel Sample', null, 'male']]);
    expect((await h.link.roster()).find((r) => r.personId === P_SAM)).toMatchObject({ kind: 'student', active: true });
    expect((await h.one(GRADE, checkIn(P_SAM))).outcome).toBe('saved');
  });
  it('the push never deactivates anyone already on the roster', async () => {
    const h = await setup();
    const s = search('Sam');
    await h.one(GRADE, s); await h.claim(20);
    await h.sync.push('doorSearch', pushBody(s.id, [SAM]));
    expect((await h.link.roster()).filter((r) => r.active).map((r) => r.personId).sort()).toEqual([P_AMY, P_SAM].sort());
  });
  it('a push for a row this console does not hold (pending, another console, unknown id) is not applied', async () => {
    const h = await setup();
    const s = search('Sam');
    await h.one(GRADE, s);
    expect(await h.sync.push('doorSearch', pushBody(s.id, [SAM]))).toEqual({ applied: false }); // still pending
    await h.claim(20);
    expect(await h.sync.push('doorSearch', pushBody(s.id, [SAM], OTHER_CONSOLE))).toEqual({ applied: false });
    expect(await h.sync.push('doorSearch', pushBody(nid(), [SAM]))).toEqual({ applied: false });
    expect((await h.link.roster()).some((r) => r.personId === P_SAM)).toBe(false);
  });
  it('no hit: refused person-unknown, which only that login reads back (the phone says Not found in Elvanto)', async () => {
    const h = await setup();
    const s = search('Zed');
    await h.one(GRADE, s); await h.claim(20);
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: s.id, outcome: 'refused', reason: 'person-unknown' }] });
    expect((await h.svc.listActions(GRADE, { ids: s.id }))[0]).toMatchObject({ status: 'refused', reason: 'person-unknown' });
    expect(await h.svc.listActions(GRADE2, { ids: s.id })).toEqual([]);
  });
});
