// link.service (lane D, plan Tasks D1–D6; spec 2026-10-12-elvanto-link-app-design.md §6, §8.2, §9.1).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeLinkService, LINK_RATE_MAX, LINK_RATE_WINDOW_MS, type LinkService } from '../services/link.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { RateLimiter } from '../utils/rate-limiter';
import type { Actor } from '../core/entities/user';
import type { Capabilities, LinkGroupRow } from '../core/link-types';
import { parseGroupName } from '../services/import.service';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-16T09:00:00.000Z'); // Friday 19:00 Brisbane
const TODAY = '2026-10-16';
const T0 = '2026-10-01T00:00:00.000Z';

// ---- ids
const ADMIN_ID = u(1), DIR_ID = u(2), QUAD_ID = u(3), GRADE_ID = u(4), LEAD_ID = u(5), GRADE2_ID = u(6), QB_ID = u(7);
const P_AMY = u(101), P_BEN = u(102), P_CODY = u(103), P_EVE1 = u(104), P_EVE2 = u(105), P_OLD = u(106), P_TOM = u(107),
  P_PAT = u(108);
const ST = u(201), ST_SUN = u(202), ST_OLD = u(203), SVC = u(211), SVC_SUN = u(212), SVC_OLD = u(213), ROOM = u(221);
const L_CODY = u(301), L_DANA = u(302), L_EVE = u(303), L_FAY = u(304);
const G9F = u(401), G10M = u(402), GX = u(403), R1 = u(411), R2 = u(412);
const FR1 = u(501), FR2 = u(502), FR3 = u(503), FLOW_A = u(511), FLOW_B = u(512), STEP1 = u(521), STEP2 = u(522), STEP3 = u(523);
// T4: each flow's lowest step is "step 0" (admin/director only), so each flow gets one ahead of the steps tested here.
const FR0B = u(504), FR0A = u(505), STEP0B = u(524), STEP0A = u(525);
const CONSOLE = u(601), CONSOLE2 = u(602);
const S_AMY = u(701), S_BEN = u(702), S_TOM = u(703);

const actor = (id: string, role: string, o: Partial<Actor> = {}): Actor =>
  ({ id, role: role as Actor['role'], displayName: `${role} login`, grade: null, quad: null, gender: null, leaderId: null, ...o });
const ADMIN = actor(ADMIN_ID, 'admin');
const DIRECTOR = actor(DIR_ID, 'director');
const QUAD = actor(QUAD_ID, 'quad', { quad: 'g79' });
const QUAD_B = actor(QB_ID, 'quad', { quad: 'b1012' });
const GRADE = actor(GRADE_ID, 'grade', { grade: 9, gender: 'female' });
const GRADE2 = actor(GRADE2_ID, 'grade', { grade: 9, gender: 'male' });
const LEADER = actor(LEAD_ID, 'leader', { leaderId: L_CODY });
const DEV = { id: 'dev-1', label: 'iPhone · Safari' };

const CAPS: Capabilities = { checkIn: 'live', checkOut: 'locked', submitReport: 'shadow', editReport: 'shadow',
  completeStep: 'live', firstTimerCheckIn: 'live' };

let idn = 9000;
const nid = () => u(++idn);

type Mode = 'off' | 'shadow' | 'on';
interface H {
  svc: LinkService; link: InMemoryLinkRepository; clock: { now: Date };
  sessions: InMemoryServiceSessionRepository; attendance: InMemoryServiceAttendanceRepository;
  leaders: InMemoryLeaderRepository;
}

const student = (id: string, first: string, last: string, gender: 'male' | 'female', grade: number) => ({
  id, firstName: first, lastName: last, gender, grade, quad: null, mobile: '0400000000', parentPhone: null,
  dateOfBirth: '2011-05-01', svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
  prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0, atRiskStatus: null, dataSource: null,
  createdAt: T0, updatedAt: T0,
});
const leader = (id: string, fullName: string, gender: 'male' | 'female' | null, active = true) => ({
  id, fullName, gender, grades: [], active, createdByGrade: null, smsTemplate: null, createdAt: T0, updatedAt: T0,
});

const group = (g: Omit<LinkGroupRow, 'grade' | 'gender' | 'history'> & Partial<Pick<LinkGroupRow, 'history'>>): LinkGroupRow =>
  ({ history: [], ...g, ...parseGroupName(g.name) });

type Modes = Partial<Record<'newYouthForms' | 'checkin' | 'lifegroupReport' | 'flows', Mode>>;
async function setup(mode: Mode | Modes = 'on', o: { console?: boolean; caps?: Partial<Capabilities>; limiter?: { isBlocked(k: string): boolean } } = {}): Promise<H> {
  const modes = typeof mode === 'string' ? { newYouthForms: mode, checkin: mode, lifegroupReport: mode, flows: mode }
    : { newYouthForms: 'off', checkin: 'off', lifegroupReport: 'off', flows: 'off', ...mode };
  const clock = { now: NOW };
  const link = new InMemoryLinkRepository({ now: () => clock.now });
  const settings = new InMemorySettingsRepository();
  const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository();
  const users = new InMemoryUserRepository();
  const sessions = new InMemoryServiceSessionRepository();
  const attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, students, leaders, users, sessions, attendance]) await r.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, ...modes } } } as never);
  for (const [id, email, role] of [[ADMIN_ID, 'admin', 'admin'], [DIR_ID, 'director', 'director'], [QUAD_ID, 'g79', 'quad'],
    [GRADE_ID, 'grade9g', 'grade'], [LEAD_ID, 'cody', 'leader'], [GRADE2_ID, 'grade9b', 'grade'], [QB_ID, 'b1012', 'quad']] as const) {
    await users.save({ id, email, displayName: `${email} name`, role, status: 'active', createdAt: T0, updatedAt: T0 } as never);
  }
  await students.save(student(S_AMY, 'Amy', 'Adams', 'female', 9) as never);
  await students.save(student(S_BEN, 'Ben', 'Brown', 'male', 9) as never);
  await students.save(student(S_TOM, 'Tom', 'Ten', 'male', 10) as never);
  for (const l of [leader(L_CODY, 'Cody  Cobb', 'male'), leader(L_DANA, 'Dana Day', 'female'), leader(L_EVE, 'Eve Evans', 'female'),
    leader(L_FAY, 'Fay Fox', 'female', false)]) await leaders.save(l as never);

  const meta = (takenAt: string) => ({ takenAt, consoleId: CONSOLE });
  const person = (personId: string, firstName: string, lastName: string, gender: 'male' | 'female' | null, grade: number | null,
    kind: 'student' | 'leader' | 'other') => ({ personId, firstName, lastName, gender, grade, kind });
  const roster = [person(P_AMY, 'Amy', 'Adams', 'female', 9, 'student'), person(P_BEN, 'Ben', 'Brown', 'male', 9, 'student'),
    person(P_CODY, 'Cody', 'Cobb', 'male', null, 'leader'), person(P_EVE1, 'Eve', 'Evans', 'female', 10, 'student'),
    person(P_EVE2, 'Eve', 'Evans', 'female', 10, 'student'), person(P_TOM, 'Tom', 'Ten', 'male', 10, 'student'),
    person(P_PAT, 'Pat', 'Parent', 'female', null, 'other')];
  await link.replaceMirror('roster', [...roster, person(P_OLD, 'Old', 'Person', 'male', 9, 'student')], meta('2026-10-16T07:00:00.000Z'));
  await link.replaceMirror('roster', roster, meta('2026-10-16T08:00:00.000Z'));
  await link.setMatches([{ personId: P_AMY, studentId: S_AMY, match: 'auto' }, { personId: P_TOM, studentId: S_TOM, match: 'manual' }]);
  await link.replaceMirror('services', [
    { serviceTimeId: ST, serviceId: SVC, name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: TODAY,
      rooms: [{ id: ROOM, name: 'Youth Program' }], checkedIn: [{ personId: P_BEN, roomId: ROOM }] },
    { serviceTimeId: ST_SUN, serviceId: SVC_SUN, name: 'Connect', startsAt: '2026-10-11T00:15:00.000Z', ymd: '2026-10-11',
      rooms: [], checkedIn: [] },
    { serviceTimeId: ST_OLD, serviceId: SVC_OLD, name: 'Old', startsAt: '2026-10-01T08:30:00.000Z', ymd: '2026-10-01',
      rooms: [], checkedIn: [] },
  ], meta('2026-10-16T08:00:00.000Z'));
  await link.replaceMirror('groups', [
    group({ groupId: G9F, name: 'Grade 9 Girls', meets: 'Tue 6:30 PM', members: [{ personId: P_AMY, name: 'Amy Adams', leader: false },
      { personId: P_EVE1, name: 'Eve Evans', leader: false }], thisWeek: 'reported',
      lastReport: { reportId: R1, date: '2026-10-13', time: '18:30', didNotMeet: false, attendees: [P_AMY], guests: 1,
        serviceTimeId: null, editable: true, blocked: null } }),
    group({ groupId: G10M, name: 'Grade 10 Boys', meets: 'Wednesday', members: [{ personId: P_TOM, name: 'Tom Ten', leader: false }],
      thisWeek: 'none', lastReport: { reportId: R2, date: '2026-10-14', time: '19:00', didNotMeet: false, attendees: [P_TOM],
        guests: 0, serviceTimeId: null, editable: false, blocked: 'multi-service' } }),
    group({ groupId: GX, name: 'Connect group', meets: '', members: [], thisWeek: 'none', lastReport: null }),
  ], meta('2026-10-16T08:00:00.000Z'));
  await link.replaceMirror('flows', [
    { rowId: FR1, flowId: FLOW_B, flowName: 'Bravo', stepId: STEP1, stepName: 'Welcome call', stepOrder: 2, personId: P_AMY,
      name: 'Amy Adams', due: null, assignedTo: 'Admin' },
    { rowId: FR2, flowId: FLOW_B, flowName: 'Bravo', stepId: STEP2, stepName: 'Follow up', stepOrder: 3, personId: null,
      name: 'Unknown Kid', due: null, assignedTo: 'Admin' },
    { rowId: FR0B, flowId: FLOW_B, flowName: 'Bravo', stepId: STEP0B, stepName: 'Intake', stepOrder: 1, personId: P_BEN,
      name: 'Ben Brown', due: null, assignedTo: '' },
    { rowId: FR0A, flowId: FLOW_A, flowName: 'Alpha', stepId: STEP0A, stepName: 'Intake', stepOrder: 1, personId: null,
      name: 'Pre Kid', due: null, assignedTo: '' },
    { rowId: FR3, flowId: FLOW_A, flowName: 'Alpha', stepId: STEP3, stepName: 'Coffee', stepOrder: 2, personId: P_TOM,
      name: 'Tom Ten', due: '2026-10-20', assignedTo: 'Admin' },
  ], meta('2026-10-16T08:00:00.000Z'));
  if (o.console !== false) await registerConsole(link, CONSOLE, { ...CAPS, ...o.caps });

  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions,
    serviceAttendance: attendance, limiter: o.limiter ?? new RateLimiter(LINK_RATE_MAX, LINK_RATE_WINDOW_MS), now: () => clock.now });
  return { svc, link, clock, sessions, attendance, leaders };
}

async function registerConsole(link: InMemoryLinkRepository, consoleId: string, capabilities: Capabilities, pollSeconds = 60, linkRev = 1) {
  await link.claim({ console: { consoleId, label: 'Office PC', contractVersion: 1, consoleVersion: '1.0', inWindow: true,
    pollSeconds, capabilities, linkRev }, max: 0, leaseSeconds: 180, cutoffDays: 3, leaseLostMs: 3_600_000 });
}

const setRow = (link: InMemoryLinkRepository, id: string, cols: Record<string, string>) => {
  for (const [k, v] of Object.entries(cols)) link._backdate('link_outbox', id, k, v);
};
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'THREW');

const checkIn = (personId = P_AMY, extra: Record<string, unknown> = {}) =>
  ({ id: nid(), type: 'checkIn', payload: { serviceTimeId: ST, serviceId: SVC, personId }, note: null, leaderId: null, ...extra });
const checkOut = (personId = P_AMY, extra: Record<string, unknown> = {}) =>
  ({ id: nid(), type: 'checkOut', payload: { serviceTimeId: ST, personId }, note: null, leaderId: null, ...extra });
const report = (p: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id: nid(), type: 'submitReport',
  payload: { groupId: G9F, date: '2026-10-13', didNotMeet: false, attendees: [P_AMY], guests: 0, notesPrivate: false,
    serviceTimeId: null, ...p }, note: null, leaderId: L_DANA, ...extra });
const edit = (p: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id: nid(), type: 'editReport',
  payload: { groupId: G9F, reportId: R1, date: '2026-10-13', didNotMeet: false, attendees: [P_AMY, P_EVE1], guests: 1,
    notesPrivate: false, serviceTimeId: null,
    base: { date: '2026-10-13', didNotMeet: false, attendees: [P_AMY], guests: 1, serviceTimeId: null }, ...p },
  note: null, leaderId: L_DANA, ...extra });
const step = (p: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id: nid(), type: 'completeStep',
  payload: { rowId: FR1, flowId: FLOW_B, stepId: STEP1, personId: P_AMY, notePrivate: false, ...p }, note: null,
  leaderId: L_DANA, ...extra });
const firstTimer = (extra: Record<string, unknown> = {}) => ({ id: nid(), type: 'firstTimerCheckIn',
  payload: { serviceTimeId: ST, serviceId: SVC, firstName: 'New', lastName: 'Kid', grade: 8, gender: 'male' }, note: null,
  leaderId: null, ...extra });

// Writes go through /link/batch only (T-42): one item per call here, the result is that item's result.
type Dev = { id: string | null; label: string | null };
/** The outcome, or the code of a refusal. */
const oc = (r: { outcome: string; code?: string }) => (r.outcome === 'refused' ? r.code : r.outcome);
const one = async (s: LinkService, a: Actor, item: object, device: Dev) => (await s.batch(a, { device, items: [item] })).results[0]!;
const enq = (s: LinkService, a: Actor, item: object, device: Dev) => one(s, a, { kind: 'action', ...item }, device);
const cancel = (s: LinkService, a: Actor, id: string, leaderId: string | null, device: Dev) =>
  one(s, a, { kind: 'cancel', id, leaderId }, device);
const undo = (s: LinkService, a: Actor, id: string, leaderId: string | null, newId: string, device: Dev) =>
  one(s, a, { kind: 'undo', id, leaderId, newId }, device);

// =====================================================================================================================
describe('D1 the switch (every public method)', () => {
  const use: [string, (s: LinkService, a: Actor) => Promise<unknown>][] = [
    ['status', (s, a) => s.status(a)],
    ['checkin', (s, a) => s.checkin(a)],
    ['enqueue', (s, a) => enq(s, a, checkIn(), DEV)],
    ['cancel', (s, a) => cancel(s, a, u(8888), null, DEV)],
    ['undo', (s, a) => undo(s, a, u(8888), null, u(8889), DEV)],
    ['listActions', (s, a) => s.listActions(a, { ids: u(8888) })],
    ['batch', (s, a) => s.batch(a, { device: DEV, items: [{ kind: 'identity', id: nid(), at: NOW.toISOString(), from: null, to: L_CODY }] })],
    ['lifegroups', (s, a) => s.lifegroups(a)],
    ['flows', (s, a) => s.flows(a)],
  ];
  const adm: [string, (s: LinkService, a: Actor) => Promise<unknown>][] = [
    ['rosterForMatching', (s, a) => s.rosterForMatching(a, {})],
    ['setMatch', (s, a) => s.setMatch(a, P_BEN, { studentId: null })],
    ['shadowCheck', (s, a) => s.shadowCheck(a, TODAY)],
    ['log', (s, a) => s.log(a, {})],
  ];
  const everyone = [ADMIN, DIRECTOR, QUAD, GRADE, LEADER];

  // T9: the admin page (status, listActions, cancel via batch, the admin routes) works for the admin in every module state.
  const adminAlways = new Set(['status', 'listActions', 'enqueue', 'cancel', 'undo', 'batch']);

  it('off: 404 MODULE_DISABLED for every role; the admin keeps its page (T9); admin routes 403 for the rest', async () => {
    const h = await setup('off');
    for (const [name, f] of use) for (const a of everyone) {
      const want = a === ADMIN && adminAlways.has(name) ? 'ok' : 'MODULE_DISABLED';
      expect(`${name}:${a.role}:${await code(f(h.svc, a))}`).toBe(`${name}:${a.role}:${want}`);
    }
    for (const [name, f] of adm) for (const a of everyone) {
      expect(`${name}:${a.role}:${await code(f(h.svc, a))}`).toBe(`${name}:${a.role}:${a === ADMIN ? 'ok' : 'FORBIDDEN'}`);
    }
  });

  it('shadow: admin only; everyone else 404 (403 on the admin routes)', async () => {
    const h = await setup('shadow');
    for (const [name, f] of [...use, ...adm]) {
      expect(`${name}:${await code(f(h.svc, ADMIN))}`).toBe(`${name}:ok`);
      const want = adm.some(([n]) => n === name) ? 'FORBIDDEN' : 'MODULE_DISABLED';
      for (const a of [DIRECTOR, QUAD, GRADE, LEADER]) expect(`${name}:${a.role}:${await code(f(h.svc, a))}`).toBe(`${name}:${a.role}:${want}`);
    }
  });

  it('on: link:use for every role; link:admin 403 for everyone but the admin (T9: directors too)', async () => {
    const h = await setup('on');
    for (const [name, f] of use) for (const a of everyone) expect(`${name}:${a.role}:${await code(f(h.svc, a))}`).toBe(`${name}:${a.role}:ok`);
    for (const [name, f] of adm) {
      expect(`${name}:admin:${await code(f(h.svc, ADMIN))}`).toBe(`${name}:admin:ok`);
      for (const a of [DIRECTOR, QUAD, GRADE, LEADER]) expect(`${name}:${a.role}:${await code(f(h.svc, a))}`).toBe(`${name}:${a.role}:FORBIDDEN`);
    }
  });

  it('T10: each screen follows its own module; /link/checkin serves check-in or the report form', async () => {
    const only = async (m: Modes) => {
      const h = await setup(m);
      return Object.fromEntries(await Promise.all([...use].map(async ([n, f]) => [n, await code(f(h.svc, GRADE))])));
    };
    const ok = (names: string[]) => Object.fromEntries(use.map(([n]) => [n, names.includes(n) ? 'ok' : 'MODULE_DISABLED']));
    // batch-borne names (enqueue/cancel/undo/batch) pass the envelope when any link screen is usable; items are checked alone.
    const shared = ['status', 'listActions', 'enqueue', 'cancel', 'undo', 'batch'];
    expect(await only({ checkin: 'on' })).toEqual(ok([...shared, 'checkin']));
    expect(await only({ lifegroupReport: 'on' })).toEqual(ok([...shared, 'checkin', 'lifegroups']));
    expect(await only({ flows: 'on' })).toEqual(ok([...shared, 'flows']));
    expect(await only({ newYouthForms: 'on' })).toEqual(ok([])); // New person alone opens no link screen
  });

  it('T10: a batch item is refused when its own module is off (report off, check-in on)', async () => {
    const h = await setup({ checkin: 'on' });
    expect(await enq(h.svc, GRADE, report(), DEV)).toMatchObject({ outcome: 'refused', code: 'MODULE_DISABLED' });
    expect(await enq(h.svc, GRADE, step(), DEV)).toMatchObject({ outcome: 'refused', code: 'MODULE_DISABLED' });
    expect((await enq(h.svc, GRADE, checkIn(), DEV)).outcome).toBe('saved');
  });
});

describe('D1 status', () => {
  it('online within 2 × pollSeconds + 60 s; capabilities from the newest console; consoles seen in 10 min', async () => {
    const h = await setup();
    h.clock.now = new Date(NOW.getTime() - 11 * 60_000);
    await registerConsole(h.link, CONSOLE2, { ...CAPS, checkIn: 'off' }, 30); // older
    h.clock.now = new Date(NOW.getTime() + 180_000);
    let s = await h.svc.status(ADMIN);
    expect(s.console).toMatchObject({ lastSeenAt: NOW.toISOString(), online: true, inWindow: true, pollSeconds: 60,
      capabilities: CAPS, consoles: 1 });
    expect(s.mirrors.roster).toEqual({ takenAt: '2026-10-16T08:00:00.000Z', ageSeconds: 3780 });
    h.clock.now = new Date(NOW.getTime() + 181_000);
    s = await h.svc.status(ADMIN);
    expect(s.console.online).toBe(false);
  });

  it('no console yet: online false, capabilities null', async () => {
    const h = await setup('on', { console: false });
    const s = await h.svc.status(GRADE);
    expect(s.console).toEqual({ lastSeenAt: null, online: false, inWindow: false, pollSeconds: null, capabilities: null, consoles: 0 });
  });
});

describe('D1 checkin read', () => {
  it('no service: today, the pick list newest first, the Friday default', async () => {
    const h = await setup();
    const r = await h.svc.checkin(GRADE);
    expect(r.today).toBe(TODAY);
    expect(r.services.map((s) => s.serviceTimeId)).toEqual([ST, ST_SUN]);
    expect(r.defaultServiceTimeId).toBe(ST);
    expect(r.people).toBeUndefined();
  });

  it('APP-43: each pick-list service says whether it is its own day’s default (Friday; Sunday 10:15 only)', async () => {
    const h = await setup();
    await h.link.replaceMirror('services', [
      { serviceTimeId: ST, serviceId: SVC, name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z', ymd: TODAY, rooms: [], checkedIn: [] },
      { serviceTimeId: ST_SUN, serviceId: SVC_SUN, name: 'Connect', startsAt: '2026-10-11T00:15:00.000Z', ymd: '2026-10-11', rooms: [], checkedIn: [] },
      { serviceTimeId: ST_OLD, serviceId: SVC_OLD, name: 'Evening', startsAt: '2026-10-11T08:00:00.000Z', ymd: '2026-10-11', rooms: [], checkedIn: [] },
    ], { takenAt: '2026-10-16T08:59:00.000Z', consoleId: CONSOLE });
    const r = await h.svc.checkin(GRADE);
    expect(Object.fromEntries(r.services.map((s) => [s.serviceTimeId, s.isDefault]))).toEqual({ [ST]: true, [ST_SUN]: true, [ST_OLD]: false });
  });

  it('B9 / D3: at 00:30 on Saturday the default is still Friday\u2019s service; Sunday stays 10:15 only', async () => {
    const h = await setup();
    h.clock.now = new Date('2026-10-16T14:30:00.000Z'); // Sat 00:30 Brisbane
    const r = await h.svc.checkin(GRADE);
    expect(r.today).toBe('2026-10-17');
    expect(r.defaultServiceTimeId).toBe(ST);
    h.clock.now = new Date('2026-10-16T17:00:00.000Z'); // Sat 03:00
    expect((await h.svc.checkin(GRADE)).defaultServiceTimeId).toBeNull();
  });

  it('one service: active student + leader rows, sorted, name/grade/leader only', async () => {
    const h = await setup();
    const r = await h.svc.checkin(GRADE, ST);
    expect(r.people!.map((p) => p.name)).toEqual(['Amy Adams', 'Ben Brown', 'Cody Cobb', 'Eve Evans', 'Eve Evans', 'Tom Ten']);
    for (const p of r.people!) {
      expect(Object.keys(p).sort()).toEqual(['action', 'checkedIn', 'grade', 'leader', 'mine', 'name', 'personId']);
    }
    const ben = r.people!.find((p) => p.personId === P_BEN)!;
    expect(ben).toMatchObject({ checkedIn: true, action: null, mine: false, grade: 9, leader: false });
    expect(r.people!.find((p) => p.personId === P_CODY)!.leader).toBe(true);
  });

  it('action is the newest row by any login; mine is createdBy === actor', async () => {
    const h = await setup();
    const it1 = checkIn(P_AMY);
    expect((await enq(h.svc, GRADE, it1, DEV)).outcome).toBe('saved');
    const mine = (await h.svc.checkin(GRADE, ST)).people!.find((p) => p.personId === P_AMY)!;
    expect(mine).toMatchObject({ checkedIn: true, mine: true, action: { id: it1.id, type: 'checkIn', status: 'pending', reason: null } });
    const theirs = (await h.svc.checkin(ADMIN, ST)).people!.find((p) => p.personId === P_AMY)!;
    expect(theirs).toMatchObject({ checkedIn: true, mine: false, action: { id: it1.id } });
  });

  it('leaders: active app leaders A–Z, matched to the roster by name', async () => {
    const h = await setup();
    const r = await h.svc.checkin(QUAD, ST);
    expect(r.leaders!.map((l) => l.name)).toEqual(['Cody  Cobb', 'Dana Day', 'Eve Evans']); // Fay is inactive
    for (const l of r.leaders!) {
      expect(Object.keys(l).sort()).toEqual(['action', 'checkedIn', 'leaderId', 'mine', 'name', 'personId']);
    }
    const by = Object.fromEntries(r.leaders!.map((l) => [l.leaderId, l]));
    expect(by[L_CODY]!.personId).toBe(P_CODY);        // one match (spaces folded)
    expect(by[L_DANA]).toMatchObject({ personId: null, checkedIn: false, action: null }); // no match
    expect(by[L_EVE]).toMatchObject({ personId: null, checkedIn: false, action: null });  // two roster rows
  });

  it('a linked leader checked in by a shadowed row shows the shadowed action (practice)', async () => {
    const h = await setup();
    const it1 = checkIn(P_CODY);
    await enq(h.svc, ADMIN, it1, DEV);
    setRow(h.link, it1.id, { status: 'shadowed', result_at: NOW.toISOString() });
    const r = await h.svc.checkin(GRADE, ST);
    expect(r.leaders!.find((l) => l.leaderId === L_CODY)).toMatchObject({ checkedIn: true,
      action: { id: it1.id, status: 'shadowed' }, mine: false });
  });

  it('genders must agree when both are set', async () => {
    const h = await setup();
    await h.link.replaceMirror('roster', [{ personId: P_CODY, firstName: 'Dana', lastName: 'Day', gender: 'male', grade: null,
      kind: 'leader' }], { takenAt: '2026-10-16T08:30:00.000Z', consoleId: CONSOLE });
    const r = await h.svc.checkin(GRADE, ST);
    expect(r.leaders!.find((l) => l.leaderId === L_DANA)!.personId).toBeNull();
  });
});

describe('B11 / T-34 leader mapping and person kind (APP-10, APP-31, APP-55)', () => {
  it('APP-10: an app leader with a same-name student and no leader row is Not linked', async () => {
    const h = await setup();
    await h.leaders.save(leader(u(305), 'Amy Adams', 'female') as never);
    const r = await h.svc.checkin(QUAD, ST);
    expect(r.leaders!.find((l) => l.leaderId === u(305))).toMatchObject({ personId: null, checkedIn: false });
  });
  it('APP-55: two active app leaders that fold to the same name are both Not linked', async () => {
    const h = await setup();
    await h.leaders.save(leader(u(306), 'cody cobb', 'male') as never);
    const r = await h.svc.checkin(QUAD, ST);
    expect(r.leaders!.filter((l) => l.name.toLowerCase().replace(/\s+/g, ' ') === 'cody cobb').map((l) => l.personId)).toEqual([null, null]);
    await h.leaders.save(leader(u(306), 'cody cobb', 'male', false) as never); // an inactive namesake does not count
    expect((await h.svc.checkin(QUAD, ST)).leaders!.find((l) => l.leaderId === L_CODY)!.personId).toBe(P_CODY);
  });
  it('APP-31: a check-in for an other-kind person is refused; a check-out is allowed', async () => {
    const h = await setup();
    expect(await enq(h.svc, GRADE, checkIn(P_PAT), DEV)).toMatchObject({ outcome: 'refused', code: 'BAD_REQUEST',
      message: 'Only youth and leaders can be checked in here.' });
    await h.link.replaceMirror('services', [{ serviceTimeId: ST, serviceId: SVC, name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z',
      ymd: TODAY, rooms: [], checkedIn: [{ personId: P_PAT, roomId: ROOM }] }], { takenAt: '2026-10-16T08:50:00.000Z', consoleId: CONSOLE });
    expect((await enq(h.svc, GRADE, checkOut(P_PAT), DEV)).outcome).toBe('saved');
  });
});

// =====================================================================================================================
describe('D2 enqueue', () => {
  it('saved: fills student_id from the roster match and service_date from the service', async () => {
    const h = await setup();
    const it1 = checkIn(P_AMY);
    const r = await enq(h.svc, GRADE, it1, DEV);
    expect(r).toMatchObject({ id: it1.id, kind: 'action', outcome: 'saved',
      action: { id: it1.id, type: 'checkIn', status: 'pending', reason: null } });
    const row = (await h.link.getAction(it1.id))!;
    expect(row).toMatchObject({ studentId: S_AMY, personId: P_AMY, serviceDate: TODAY, createdBy: GRADE_ID,
      leaderId: null, leaderName: 'grade login', dedupeKey: `checkIn:${ST}:${P_AMY}` });
  });

  it('B12 / T-36: 600 new inserts per login in 10 min; the 601st is refused RATE_LIMITED; replays and duplicates never count', async () => {
    expect(LINK_RATE_MAX).toBe(600);
    expect(LINK_RATE_WINDOW_MS).toBe(600_000);
    const h = await setup();
    const it1 = checkIn(P_AMY);
    for (let i = 0; i < 300; i++) expect((await enq(h.svc, GRADE, it1, DEV)).outcome).not.toBe('refused'); // 1 insert + 299 replays
    for (let i = 0; i < 50; i++) expect((await enq(h.svc, GRADE, checkIn(P_AMY), DEV)).outcome).toBe('duplicate');
    const ft = (i: number) => firstTimer({ payload: { serviceTimeId: ST, serviceId: SVC, firstName: 'New', lastName: `Kid${i}`, grade: 8, gender: 'male' } });
    for (let i = 0; i < 599; i++) expect((await enq(h.svc, GRADE, ft(i), DEV)).outcome).toBe('saved');
    expect(await enq(h.svc, GRADE, ft(999), DEV)).toMatchObject({ outcome: 'refused', code: 'RATE_LIMITED' });
    expect((await enq(h.svc, GRADE, it1, DEV)).outcome).toBe('replay'); // still answered after the limit
    expect((await enq(h.svc, QUAD, ft(1000), DEV)).outcome).toBe('saved'); // per login
  });

  it('replay (same id, same body) returns the row; same id, other body → LINK_ID_REUSED', async () => {
    const h = await setup();
    const it1 = checkIn(P_AMY);
    await enq(h.svc, GRADE, it1, DEV);
    expect(await enq(h.svc, GRADE, { ...it1, payload: { personId: P_AMY, serviceId: SVC, serviceTimeId: ST } }, DEV))
      .toMatchObject({ outcome: 'replay', action: { id: it1.id, status: 'pending' } });
    expect(await enq(h.svc, GRADE, { ...it1, payload: { ...it1.payload, personId: P_BEN } }, DEV))
      .toMatchObject({ outcome: 'refused', code: 'LINK_ID_REUSED' });
  });

  it('LINK_UNAVAILABLE when the newest console has the type off; no console → allowed', async () => {
    const h = await setup('on', { caps: { checkIn: 'off' } });
    expect(await enq(h.svc, GRADE, checkIn(), DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_UNAVAILABLE' });
    const h2 = await setup('on', { console: false });
    expect((await enq(h2.svc, GRADE, checkIn(), DEV)).outcome).toBe('saved');
  });

  it('check-in type checks: service not in the pick list, wrong serviceId, person inactive or unknown', async () => {
    const h = await setup();
    const bad = async (it: object) => oc(await enq(h.svc, GRADE, it, DEV));
    expect(await bad(checkIn(P_AMY, { payload: { serviceTimeId: ST_OLD, serviceId: SVC_OLD, personId: P_AMY } }))).toBe('BAD_REQUEST');
    expect(await bad(checkIn(P_AMY, { payload: { serviceTimeId: ST, serviceId: SVC_SUN, personId: P_AMY } }))).toBe('BAD_REQUEST');
    expect(await bad(checkIn(P_OLD))).toBe('BAD_REQUEST');
    expect(await bad(checkIn(u(999)))).toBe('BAD_REQUEST');
    expect(await bad({ id: nid(), type: 'checkIn', payload: { serviceTimeId: ST } })).toBe('VALIDATION_ERROR'); // Zod
  });

  it('report type checks: date window, attendees ⊆ members, didNotMeet, serviceTimeId in link_services', async () => {
    const h = await setup();
    const st = async (it: object) => oc(await enq(h.svc, DIRECTOR, it, DEV));
    expect(await st(report({ date: '2026-10-17' }))).toBe('BAD_REQUEST');                   // > today
    expect(await st(report({ date: '2026-10-01' }))).toBe('BAD_REQUEST');                   // < today − 14
    expect(await st(report({ date: '2026-10-02' }))).toBe('saved');                   // = today − 14
    expect(await st(report({ date: '2026-10-03', attendees: [P_BEN] }))).toBe('BAD_REQUEST'); // not a member
    expect(await st(report({ date: '2026-10-04', didNotMeet: true }))).toBe('VALIDATION_ERROR');  // attendees with didNotMeet
    expect(await st(report({ date: '2026-10-05', serviceTimeId: u(998) }))).toBe('BAD_REQUEST');
    expect(await st(report({ date: '2026-10-06', serviceTimeId: ST_OLD }))).toBe('saved'); // in link_services, not the pick list
    expect(await st(report({ date: '2026-10-07', groupId: u(997) }))).toBe('BAD_REQUEST');
  });

  it('report scope: a group out of scope is 403', async () => {
    const h = await setup();
    expect(await enq(h.svc, GRADE, report({ groupId: G10M, attendees: [P_TOM] }), DEV))
      .toMatchObject({ outcome: 'refused', code: 'FORBIDDEN' });
  });

  it('flow step checks: unknown row, step moved, out of scope', async () => {
    const h = await setup();
    expect((await enq(h.svc, DIRECTOR, step({ rowId: u(996) }), DEV)).code).toBe('BAD_REQUEST');
    expect((await enq(h.svc, DIRECTOR, step({ stepId: STEP2 }), DEV)).code).toBe('BAD_REQUEST');
    expect((await enq(h.svc, GRADE2, step(), DEV)).code).toBe('FORBIDDEN');
    expect((await enq(h.svc, GRADE, step({ rowId: FR2, stepId: STEP2, personId: null }), DEV)).code).toBe('FORBIDDEN');
    const ok = step();
    expect(await enq(h.svc, GRADE, ok, DEV)).toMatchObject({ outcome: 'saved' });
    expect(await h.link.getAction(ok.id)).toMatchObject({ serviceDate: TODAY, personId: P_AMY, studentId: S_AMY });
  });

  it('names over 60 characters are refused', async () => {
    const h = await setup();
    const it1 = firstTimer();
    (it1.payload as Record<string, unknown>).firstName = 'x'.repeat(61);
    expect((await enq(h.svc, GRADE, it1, DEV)).code).toBe('VALIDATION_ERROR');
    const ok = firstTimer();
    expect(await enq(h.svc, GRADE, ok, DEV)).toMatchObject({ outcome: 'saved' });
    expect(await h.link.getAction(ok.id)).toMatchObject({ personId: null, studentId: null, serviceDate: TODAY });
  });

  it('notes: only on note types; 1,800 ok, 1,801 refused', async () => {
    const h = await setup();
    expect((await enq(h.svc, GRADE, checkIn(P_AMY, { note: 'hi' }), DEV)).code).toBe('BAD_REQUEST');
    expect((await enq(h.svc, GRADE, step({}, { note: 'x'.repeat(1801) }), DEV)).code).toBe('BAD_REQUEST');
    expect((await enq(h.svc, GRADE, step({}, { note: 'x'.repeat(1800) }), DEV)).outcome).toBe('saved');
  });

  it('notes: the leader note is capped so "Self identified leader: <name> — <note>" fits 1,900 (X1)', async () => {
    const h = await setup();
    const r1900 = await enq(h.svc, GRADE, step({}, { note: 'x'.repeat(1900) }), DEV);
    expect(r1900).toMatchObject({ outcome: 'refused', code: 'BAD_REQUEST', message: 'A note can be up to 1800 characters.' });
    const LONG = 'c0000000-0000-4000-8000-00000000abcd';
    const name = 'N'.repeat(90);
    await h.leaders.save(leader(LONG, name, 'female') as never);
    const room = 1900 - 'Self identified leader: '.length - name.length - ' — '.length; // 1783
    const over = await enq(h.svc, GRADE, step({}, { note: 'x'.repeat(room + 1), leaderId: LONG }), DEV);
    expect(over).toMatchObject({ outcome: 'refused', code: 'BAD_REQUEST', message: `A note can be up to ${room} characters.` });
    const fits = step({}, { note: 'x'.repeat(room), leaderId: LONG });
    expect((await enq(h.svc, GRADE, fits, DEV)).outcome).toBe('saved');
    // The stored note stays the leader's own words.
    expect(h.link._peekNote(fits.id)).toBe('x'.repeat(room));
  });

  it('"I am" is required for reports and flow steps', async () => {
    const h = await setup();
    for (const it of [report({}, { leaderId: null }), edit({}, { leaderId: u(995) }), step({}, { leaderId: undefined })]) {
      expect(await enq(h.svc, DIRECTOR, it, DEV)).toMatchObject({ outcome: 'refused', code: 'BAD_REQUEST', message: 'Pick who you are first.' });
    }
  });

  it('a junior leader login always gets its bound leaderId; other types fall back to the login name', async () => {
    const h = await setup();
    const it1 = checkIn(P_AMY, { leaderId: L_DANA });
    await enq(h.svc, LEADER, it1, DEV);
    expect(await h.link.getAction(it1.id)).toMatchObject({ leaderId: L_CODY, leaderName: 'Cody  Cobb' });
    const it2 = checkIn(P_BEN, { leaderId: L_DANA });
    await enq(h.svc, GRADE, it2, DEV);
    expect(await h.link.getAction(it2.id)).toMatchObject({ leaderId: L_DANA, leaderName: 'Dana Day' });
    const it3 = checkIn(P_TOM);
    await enq(h.svc, GRADE, it3, DEV);
    expect(await h.link.getAction(it3.id)).toMatchObject({ leaderId: null, leaderName: 'grade login' });
  });

  it('same-action dedupe: a second checkIn from another login → duplicate + existingId, one row', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'sent', result_at: NOW.toISOString() }); // not open any more
    expect(await enq(h.svc, QUAD, checkIn(P_AMY), DEV)).toMatchObject({ outcome: 'duplicate', existingId: a.id, action: { id: a.id, status: 'sent' } });
    expect(await h.link.listActions({ personId: P_AMY })).toHaveLength(1);
  });

  it('a sent check-in then a kiosk check-out (newer mirror, out) allows a new check-in', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'sent', result_at: '2026-10-16T08:40:00.000Z' });
    await h.link.replaceMirror('services', [{ serviceTimeId: ST, serviceId: SVC, name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z',
      ymd: TODAY, rooms: [], checkedIn: [] }], { takenAt: '2026-10-16T08:50:00.000Z', consoleId: CONSOLE });
    expect((await enq(h.svc, QUAD, checkIn(P_AMY), DEV)).outcome).toBe('saved');
  });

  it('a junior leader\'s cancel is owned and logged under its bound leader', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, LEADER, a, DEV);
    expect((await cancel(h.svc, LEADER, a.id, L_DANA, DEV)).outcome).toBe('cancelled');
    const log = await h.link.listLog({ from: T0, to: '2026-11-01T00:00:00.000Z', event: 'cancel', limit: 5 });
    expect(log[0]).toMatchObject({ leaderId: L_CODY, leaderName: 'Cody  Cobb' });
  });

  it('checkOut after a pending check-in → cancelled (B4); after a shadowed check-in → saved; with no check-in → 400', async () => {
    const h = await setup();
    await enq(h.svc, GRADE, checkIn(P_AMY), DEV);
    expect((await enq(h.svc, GRADE, checkOut(P_AMY), DEV)).outcome).toBe('cancelled');
    const c = checkIn(P_TOM);
    await enq(h.svc, GRADE, c, DEV);
    setRow(h.link, c.id, { status: 'shadowed', result_at: NOW.toISOString() });
    expect((await enq(h.svc, GRADE, checkOut(P_TOM), DEV)).outcome).toBe('saved');
    expect((await enq(h.svc, GRADE, checkOut(P_EVE1), DEV)).code).toBe('BAD_REQUEST');
    expect((await enq(h.svc, GRADE, checkOut(P_BEN), DEV)).outcome).toBe('saved'); // in by the mirror
  });

  it('report duplicate by key → duplicate + existingId', async () => {
    const h = await setup();
    const a = report({ date: '2026-10-14' });
    await enq(h.svc, DIRECTOR, a, DEV);
    expect(await enq(h.svc, GRADE, report({ date: '2026-10-14' }), DEV)).toMatchObject({ outcome: 'duplicate', existingId: a.id });
  });

  it('editReport: last report, editable, base, date', async () => {
    const h = await setup();
    const st = async (it: object, a: Actor = DIRECTOR) => enq(h.svc, a, it, DEV);
    expect((await st(edit({ reportId: u(994) }))).code).toBe('BAD_REQUEST');
    expect(await st(edit({ groupId: G10M, reportId: R2, date: '2026-10-14', attendees: [P_TOM],
      base: { date: '2026-10-14', didNotMeet: false, attendees: [P_TOM], guests: 0, serviceTimeId: null } })))
      .toMatchObject({ outcome: 'refused', code: 'LINK_EDIT_IN_ELVANTO', reason: 'multi-service' });
    expect((await st(edit({ base: { date: '2026-10-13', didNotMeet: false, attendees: [P_AMY], guests: 2, serviceTimeId: null } }))).code).toBe('BAD_REQUEST');
    expect((await st(edit({ date: '2026-10-12' }))).code).toBe('BAD_REQUEST');
    expect((await st(edit())).outcome).toBe('saved');
  });

  it('editReport: the overlay (newest sent submit with report_id after the groups push) is the last report', async () => {
    const h = await setup();
    const sub = report({ date: '2026-10-15' });
    await enq(h.svc, DIRECTOR, sub, DEV);
    const NEW_R = u(413);
    setRow(h.link, sub.id, { status: 'sent', result_at: '2026-10-16T08:45:00.000Z', report_id: NEW_R });
    expect((await enq(h.svc, DIRECTOR, edit({ reportId: u(998) }), DEV)).code).toBe('BAD_REQUEST'); // not in the group at all
    expect((await enq(h.svc, DIRECTOR, edit({ reportId: NEW_R, date: '2026-10-15',
      base: { date: '2026-10-15', didNotMeet: false, attendees: [P_AMY], guests: 0, serviceTimeId: null } }), DEV)).outcome).toBe('saved');
  });
});

// =====================================================================================================================
describe('B5 / T-11 a shadowed row is not "in" for the duplicate check (APP-46; X13)', () => {
  it('shadowed at 6:45 pm, the type goes live, a re-tap is saved; the door still shows the practice tick', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    h.clock.now = new Date('2026-10-16T08:45:00.000Z');
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'shadowed', result_at: '2026-10-16T08:46:00.000Z' });
    const view1 = await h.svc.checkin(GRADE, ST);
    expect(view1.people!.find((p) => p.personId === P_AMY)).toMatchObject({ checkedIn: true, action: { id: a.id, status: 'shadowed' } });
    h.clock.now = NOW;
    const b = checkIn(P_AMY);
    expect(await enq(h.svc, GRADE, b, DEV)).toMatchObject({ outcome: 'saved', action: { id: b.id, status: 'pending' } });
    // and a second live tap is the duplicate
    expect(await enq(h.svc, QUAD, checkIn(P_AMY), DEV)).toMatchObject({ outcome: 'duplicate', existingId: b.id });
  });
});

describe('B6 / T-30 undo and ownership (APP-5, APP-50)', () => {
  it('two "I am" leaders on one login: the second can check out (and Undo) the first leader sent check-in', async () => {
    const h = await setup();
    const a = checkIn(P_AMY, { leaderId: L_DANA });
    await enq(h.svc, GRADE, a, DEV);
    expect(await undo(h.svc, GRADE, a.id, L_CODY, nid(), DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_NOT_YOURS' }); // pending: a cancel
    setRow(h.link, a.id, { status: 'sent', result_at: NOW.toISOString() });
    const newId = nid();
    expect(await undo(h.svc, GRADE, a.id, L_CODY, newId, DEV)).toMatchObject({ outcome: 'saved',
      action: { id: newId, type: 'checkOut', status: 'pending' }, mine: true });
    const b = checkIn(P_TOM, { leaderId: L_DANA });
    await enq(h.svc, GRADE, b, DEV);
    setRow(h.link, b.id, { status: 'sent', result_at: NOW.toISOString() });
    expect((await enq(h.svc, GRADE2, checkOut(P_TOM, { leaderId: L_CODY }), DEV)).outcome).toBe('saved');
  });
  it('mine comes from the server: true on saved and replay, false on duplicate', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    expect((await enq(h.svc, GRADE, a, DEV)).mine).toBe(true);
    expect((await enq(h.svc, GRADE, a, DEV)).mine).toBe(true); // replay
    const r = await h.svc.batch(QUAD, { items: [{ kind: 'action', ...checkIn(P_AMY) }] });
    expect(r.results[0]).toMatchObject({ outcome: 'duplicate', existingId: a.id, mine: false });
  });
});

describe('B8 / T-39 tap time (APP-16), /link/batch only', () => {
  const at = (iso: string) => new Date(iso);
  it('APP-16 A: a queue opened 6 days later is refused too-old (tap time, not arrival time)', async () => {
    const h = await setup();
    h.clock.now = at('2026-10-22T09:00:00.000Z'); // Thu next week; last Friday is still in the pick list
    const old = { kind: 'action', ...checkIn(P_AMY), queuedAt: '2026-10-16T08:40:00.000Z' };
    const fresh = { kind: 'action', ...checkIn(P_TOM), queuedAt: '2026-10-22T08:59:00.000Z' };
    const r = await h.svc.batch(GRADE, { device: DEV, sentAt: '2026-10-22T09:00:00.000Z', items: [old, fresh] });
    expect(r.results[0]).toMatchObject({ outcome: 'refused', code: 'LINK_TOO_OLD', reason: 'too-old',
      message: 'Too late to send. Do it in Elvanto.' });
    expect(r.results[1]).toMatchObject({ outcome: 'saved' });
    expect(await h.link.getAction(old.id)).toBeNull();
  });
  it('APP-16 B: A taps in at 7:00 offline; B checks in at 7:01 and out at 9:00; A flushes at 9:30 → stale', async () => {
    const h = await setup();
    h.clock.now = at('2026-10-16T09:01:00.000Z');
    const b1 = checkIn(P_AMY);
    await enq(h.svc, QUAD, b1, DEV);
    setRow(h.link, b1.id, { status: 'sent', result_at: '2026-10-16T09:02:00.000Z' });
    h.clock.now = at('2026-10-16T11:00:00.000Z');
    expect((await enq(h.svc, QUAD, checkOut(P_AMY), DEV)).outcome).toBe('saved');
    h.clock.now = at('2026-10-16T11:30:00.000Z');
    // A's phone clock runs 1 h slow: tapped at its 08:00 (server 09:00), sent at its 10:30 (server 11:30)
    const a = { kind: 'action', ...checkIn(P_AMY), queuedAt: '2026-10-16T08:00:00.000Z' };
    const r = await h.svc.batch(GRADE, { device: DEV, sentAt: '2026-10-16T10:30:00.000Z', items: [a] });
    expect(r.results[0]).toMatchObject({ outcome: 'refused', code: 'LINK_STALE', reason: 'stale',
      message: 'Someone else changed this after your tap. Reload.' });
  });
  it('B8 follow-up: a phone\u2019s own earlier batch never makes its later item stale; another phone\u2019s newer row does', async () => {
    const h = await setup();
    const at = (iso: string) => new Date(iso);
    const PHONE_A = { id: 'dev-a', label: 'iPhone · Safari' }, PHONE_B = { id: 'dev-b', label: 'Android · Chrome' };
    // batch 1 (a full batch of 50) lands at 09:10; Amy's check-in was tapped at 09:00
    h.clock.now = at('2026-10-16T09:10:00.000Z');
    const amyIn = { kind: 'action', ...checkIn(P_AMY), queuedAt: '2026-10-16T09:00:00.000Z' };
    const fill = Array.from({ length: 49 }, (_, i) => ({ kind: 'action', ...firstTimer({ payload: { serviceTimeId: ST, serviceId: SVC,
      firstName: 'New', lastName: `Kid${i}`, grade: 8, gender: 'male' } }), queuedAt: '2026-10-16T09:00:00.000Z' }));
    const r1 = await h.svc.batch(GRADE, { device: PHONE_A, sentAt: '2026-10-16T09:10:00.000Z', items: [amyIn, ...fill] });
    expect(r1.results.every((x) => x.outcome === 'saved')).toBe(true);
    setRow(h.link, amyIn.id, { status: 'sent', result_at: '2026-10-16T09:11:00.000Z' });
    // batch 2 from the same phone: Amy's check-out was tapped at 09:05, before batch 1 reached the server
    h.clock.now = at('2026-10-16T09:12:00.000Z');
    const amyOut = { kind: 'action', ...checkOut(P_AMY), queuedAt: '2026-10-16T09:05:00.000Z' };
    expect((await h.svc.batch(GRADE, { device: PHONE_A, sentAt: '2026-10-16T09:12:00.000Z', items: [amyOut] })).results[0])
      .toMatchObject({ outcome: 'saved' });
    // another phone (same shared login): Tom checked in at 09:20 by phone B; phone A's check-out tapped at 09:15 is stale
    h.clock.now = at('2026-10-16T09:20:00.000Z');
    const tomIn = { kind: 'action', ...checkIn(P_TOM) };
    await h.svc.batch(GRADE, { device: PHONE_B, items: [tomIn] });
    setRow(h.link, tomIn.id, { status: 'sent', result_at: '2026-10-16T09:21:00.000Z' });
    h.clock.now = at('2026-10-16T09:30:00.000Z');
    const tomOut = { kind: 'action', ...checkOut(P_TOM), queuedAt: '2026-10-16T09:15:00.000Z' };
    expect((await h.svc.batch(GRADE, { device: PHONE_A, sentAt: '2026-10-16T09:30:00.000Z', items: [tomOut] })).results[0])
      .toMatchObject({ outcome: 'refused', code: 'LINK_STALE' });
    // and a phone with no device id gets no exemption
    const tomOut2 = { kind: 'action', ...checkOut(P_TOM), queuedAt: '2026-10-16T09:15:00.000Z' };
    expect((await h.svc.batch(GRADE, { sentAt: '2026-10-16T09:30:00.000Z', items: [tomOut2] })).results[0])
      .toMatchObject({ code: 'LINK_STALE' });
  });
  it('items of the same batch never make each other stale; no queuedAt counts as now; the single routes are unchanged', async () => {
    const h = await setup();
    const inn = { kind: 'action', ...checkIn(P_AMY), queuedAt: '2026-10-16T08:00:00.000Z' };
    const out = { kind: 'action', ...checkOut(P_TOM), queuedAt: '2026-10-16T08:10:00.000Z' };
    const tomIn = { kind: 'action', ...checkIn(P_TOM), queuedAt: '2026-10-16T08:05:00.000Z' };
    // Tom: in then out within one batch (B4 cancels the pending check-in)
    const r = await h.svc.batch(GRADE, { device: DEV, sentAt: NOW.toISOString(), items: [inn, tomIn, out] });
    expect(r.results.map((x) => x.outcome)).toEqual(['saved', 'saved', 'cancelled']);
    const plain = { kind: 'action', ...checkIn(P_EVE1) };
    expect((await h.svc.batch(GRADE, { device: DEV, items: [plain] })).results[0]!.outcome).toBe('saved');
    // a future tap (phone clock ahead) is clamped to now
    const ahead = { kind: 'action', ...checkIn(P_EVE2), queuedAt: '2026-10-17T09:00:00.000Z' };
    expect((await h.svc.batch(GRADE, { device: DEV, sentAt: NOW.toISOString(), items: [ahead] })).results[0]!.outcome).toBe('saved');
  });
});

describe('B4 / T-24 ordering (APP-3, APP-45)', () => {
  it('APP-3 A: a checkOut over a pending check-in cancels it and answers cancelled; over a claimed one it is refused', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'claimed' });
    expect(await enq(h.svc, QUAD, checkOut(P_AMY), DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_STILL_SENDING', message: 'Still sending, try again in a minute.' });
    setRow(h.link, a.id, { status: 'pending', retry_at: '2026-10-16T09:01:00.000Z' }); // the console answered retry
    const out = checkOut(P_AMY);
    expect(await enq(h.svc, QUAD, out, DEV)).toMatchObject({ outcome: 'cancelled',
      action: { id: a.id, type: 'checkIn', status: 'cancelled' } });
    expect((await h.link.getAction(a.id))!.status).toBe('cancelled');
    expect(await h.link.getAction(out.id)).toBeNull();
  });
  it('APP-3 B: Undo of a claimed check-in is refused (still sending); once it is pending again the Undo cancels it', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'claimed' });
    expect(await undo(h.svc, GRADE, a.id, null, nid(), DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_STILL_SENDING' });
    setRow(h.link, a.id, { status: 'pending' });
    expect((await undo(h.svc, GRADE, a.id, null, nid(), DEV)).outcome).toBe('cancelled');
    expect(await h.link.listActions({ personId: P_AMY, types: ['checkOut'] })).toHaveLength(0);
  });
  it('an unclear opposite row refuses both ways', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'unclear' });
    expect(await enq(h.svc, GRADE, checkOut(P_AMY), DEV)).toMatchObject({ code: 'LINK_STILL_SENDING' });
    const b = checkIn(P_TOM);
    await enq(h.svc, GRADE, b, DEV);
    setRow(h.link, b.id, { status: 'sent', result_at: NOW.toISOString() });
    const o = checkOut(P_TOM);
    await enq(h.svc, GRADE, o, DEV);
    setRow(h.link, o.id, { status: 'claimed' });
    expect(await enq(h.svc, GRADE, checkIn(P_TOM), DEV)).toMatchObject({ code: 'LINK_STILL_SENDING' });
  });
  it('APP-45 in-out-in: a checkIn over a pending check-out cancels the check-out and returns the open check-in as duplicate', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'sent', result_at: NOW.toISOString() });
    const o = checkOut(P_AMY);
    expect((await enq(h.svc, QUAD, o, DEV)).outcome).toBe('saved');
    expect(await enq(h.svc, GRADE, checkIn(P_AMY), DEV)).toMatchObject({ outcome: 'duplicate', existingId: a.id,
      action: { id: a.id, type: 'checkIn', status: 'sent' } });
    expect((await h.link.getAction(o.id))!.status).toBe('cancelled');
    // console offline the whole time: in (pending), out cancels it, in again is a fresh check-in
    const b = checkIn(P_TOM);
    await enq(h.svc, GRADE, b, DEV);
    expect((await enq(h.svc, QUAD, checkOut(P_TOM), DEV)).outcome).toBe('cancelled');
    const c = checkIn(P_TOM);
    expect((await enq(h.svc, GRADE, c, DEV)).outcome).toBe('saved');
    expect((await h.link.listActions({ personId: P_TOM, statuses: ['pending'] })).map((r) => r.id)).toEqual([c.id]);
  });
  it('smoke-2: a re-sent check-out that cancelled a pending check-in answers cancelled again (same id only)', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    const o = checkOut(P_AMY);
    const items = [{ kind: 'action', ...a }, { kind: 'action', ...o }];
    const first = (await h.svc.batch(QUAD, { device: DEV, items })).results;
    expect(first.map(oc)).toEqual(['saved', 'cancelled']);
    const again = (await h.svc.batch(QUAD, { device: DEV, items })).results; // lost reply: the phone re-sends
    expect(again.map(oc)).toEqual(['replay', 'cancelled']);
    expect(again[1]).toMatchObject({ id: o.id, action: { id: a.id, type: 'checkIn', status: 'cancelled' } });
    expect(await h.link.getAction(o.id)).toBeNull();
    // precise: a NEW check-out (other id) is still refused, the person is not in
    expect(await enq(h.svc, QUAD, checkOut(P_AMY), DEV)).toMatchObject({ outcome: 'refused', message: 'Not checked in to this service.' });
    // the same id as a different type is id reuse, not a replay
    expect(await enq(h.svc, QUAD, { ...checkIn(P_AMY), id: o.id }, DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_ID_REUSED' });
  });
  it('smoke-2 mirror: a re-sent check-in that cancelled a pending check-out answers the same duplicate', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    setRow(h.link, a.id, { status: 'sent', result_at: NOW.toISOString() });
    const o = checkOut(P_AMY);
    expect((await enq(h.svc, QUAD, o, DEV)).outcome).toBe('saved');
    const b = checkIn(P_AMY);
    const want = { outcome: 'duplicate', existingId: a.id, action: { id: a.id, type: 'checkIn', status: 'sent' } };
    expect(await enq(h.svc, GRADE, b, DEV)).toMatchObject(want);
    // the person is then checked out at the kiosk (a sent check-out); the lost-reply re-send must not check them in again
    const k = checkOut(P_AMY);
    await enq(h.svc, QUAD, k, DEV);
    setRow(h.link, k.id, { status: 'sent', result_at: NOW.toISOString() });
    expect(await enq(h.svc, GRADE, b, DEV)).toMatchObject({ outcome: 'duplicate' });
    expect(await h.link.getAction(b.id)).toBeNull();
  });
  it('a check-in without serviceId gets a specific message', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    delete (a.payload as Record<string, unknown>).serviceId;
    expect(await enq(h.svc, GRADE, a, DEV)).toMatchObject({ outcome: 'refused', message: 'A check-in needs the service (serviceId).' });
  });
});

describe('D3 cancel, undo, listActions', () => {
  it('cancel: same login + same "I am" → cancelled; other "I am" or other login → LINK_NOT_YOURS; null/null is the same', async () => {
    const h = await setup();
    const a = checkIn(P_AMY, { leaderId: L_DANA });
    await enq(h.svc, GRADE, a, DEV);
    expect(await cancel(h.svc, GRADE, a.id, L_CODY, DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_NOT_YOURS' });
    expect(await cancel(h.svc, GRADE2, a.id, L_DANA, DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_NOT_YOURS' });
    expect(await cancel(h.svc, GRADE, a.id, L_DANA, DEV)).toMatchObject({ outcome: 'cancelled' });
    const b = checkIn(P_BEN);
    await enq(h.svc, GRADE, b, DEV);
    expect((await cancel(h.svc, GRADE, b.id, null, DEV)).outcome).toBe('cancelled');
  });

  it('admin (On) can cancel anyone\'s, a director no longer can (T9); not pending → too-late', async () => {
    const h = await setup();
    const a = checkIn(P_AMY, { leaderId: L_DANA });
    await enq(h.svc, GRADE, a, DEV);
    expect(await cancel(h.svc, DIRECTOR, a.id, null, DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_NOT_YOURS' });
    expect((await cancel(h.svc, ADMIN, a.id, null, DEV)).outcome).toBe('cancelled');
    const b = report();
    await enq(h.svc, GRADE, b, DEV);
    setRow(h.link, b.id, { status: 'claimed' });
    expect(await cancel(h.svc, GRADE, b.id, L_DANA, DEV)).toMatchObject({ outcome: 'too-late', code: 'LINK_TOO_LATE' });
  });

  it('undo: pending check-in → cancelled; sent check-in → a new checkOut; non-check-in → 400', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    expect((await undo(h.svc, GRADE, a.id, null, nid(), DEV)).outcome).toBe('cancelled');
    const b = checkIn(P_TOM);
    await enq(h.svc, GRADE, b, DEV);
    setRow(h.link, b.id, { status: 'sent', result_at: NOW.toISOString() });
    const newId = nid();
    expect(await undo(h.svc, GRADE, b.id, null, newId, DEV)).toMatchObject({ outcome: 'saved',
      action: { id: newId, type: 'checkOut', status: 'pending' } });
    // B6: past pending, Undo is a plain check-out (no owner rule); the check-out already waits, so a duplicate
    expect(await undo(h.svc, QUAD, b.id, null, nid(), DEV)).toMatchObject({ outcome: 'duplicate', existingId: newId });
    const c = step();
    await enq(h.svc, GRADE, c, DEV);
    expect((await undo(h.svc, GRADE, c.id, L_DANA, nid(), DEV)).code).toBe('BAD_REQUEST');
  });

  it('listActions: own rows only for non-admins; detail for link:admin only; contract shape', async () => {
    const h = await setup();
    const a = step({}, { note: 'private words' });
    const b = checkIn(P_BEN);
    await enq(h.svc, GRADE, a, DEV);
    await enq(h.svc, QUAD, b, DEV);
    setRow(h.link, b.id, { detail: 'console sentence' });
    const ids = [a.id, b.id].join(',');
    const mine = await h.svc.listActions(GRADE, { ids });
    expect(mine.map((r) => r.id)).toEqual([a.id]);
    expect(Object.keys(mine[0]!).sort()).toEqual(['createdAt', 'hasNote', 'id', 'leaderName', 'login', 'reason', 'resultAt',
      'status', 'type']);
    expect(mine[0]).toMatchObject({ login: 'grade9g', leaderName: 'Dana Day', hasNote: true });
    expect(JSON.stringify(mine)).not.toContain('private words');
    expect(await h.svc.listActions(DIRECTOR, { ids })).toEqual([]); // T9: a director sees its own rows only
    const all = await h.svc.listActions(ADMIN, { ids });
    expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(all.find((r) => r.id === b.id)).toMatchObject({ detail: 'console sentence', login: 'g79', hasNote: false });
    expect((await h.svc.listActions(ADMIN, { serviceDate: TODAY, type: 'checkIn' })).map((r) => r.id)).toEqual([b.id]);
  });
  it('B3 / T-7: an unclear row carries the person for link:admin only; other rows and other roles never do', async () => {
    const h = await setup();
    const a = checkIn(P_BEN);
    const b = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    await enq(h.svc, GRADE, b, DEV);
    setRow(h.link, a.id, { status: 'unclear', reason: 'lease-lost' });
    const all = await h.svc.listActions(ADMIN, { serviceDate: TODAY, type: 'checkIn' });
    expect(all.find((r) => r.id === a.id)).toMatchObject({ status: 'unclear', type: 'checkIn', name: 'Ben Brown' });
    expect(all.find((r) => r.id === b.id)).not.toHaveProperty('name');
    expect((await h.svc.listActions(GRADE, { ids: a.id }))[0]).not.toHaveProperty('name');
  });
  it('B17: a first-timer row carries its name for link:admin (the waiting list), never for others', async () => {
    const h = await setup();
    const f = firstTimer();
    await enq(h.svc, GRADE, f, DEV);
    expect((await h.svc.listActions(ADMIN, { serviceDate: TODAY, type: 'firstTimerCheckIn' }))[0]).toMatchObject({ name: 'New Kid' });
    expect((await h.svc.listActions(GRADE, { ids: f.id }))[0]).not.toHaveProperty('name');
  });
});

// =====================================================================================================================
describe('D4 batch and the action log', () => {
  it('envelope: 0 or 51 items, or no items array → 400 VALIDATION_ERROR', async () => {
    const h = await setup();
    expect(await code(h.svc.batch(GRADE, { device: DEV, items: [] }))).toBe('VALIDATION_ERROR');
    const many = Array.from({ length: 51 }, () => ({ kind: 'action', ...checkIn() }));
    expect(await code(h.svc.batch(GRADE, { device: DEV, items: many }))).toBe('VALIDATION_ERROR');
    expect(await code(h.svc.batch(GRADE, { device: DEV }))).toBe('VALIDATION_ERROR');
    const h2 = await setup('off');
    expect(await code(h2.svc.batch(GRADE, { device: DEV, items: [] }))).toBe('MODULE_DISABLED');
  });

  it('A7 / APP-17: a bad item is refused alone; one corrupt item in 40 leaves 39 saved', async () => {
    const h = await setup();
    const good = Array.from({ length: 39 }, (_, i) => ({ kind: 'action', v: 1, ...firstTimer(),
      payload: { serviceTimeId: ST, serviceId: SVC, firstName: 'New', lastName: `Kid${i}`, grade: 8, gender: 'male' } }));
    const items: unknown[] = [...good.slice(0, 20), { kind: 'cancel', id: 'nope' }, ...good.slice(20)];
    const r = await h.svc.batch(GRADE, { device: DEV, items });
    expect(r.results).toHaveLength(40);
    expect(r.results[20]).toMatchObject({ id: 'nope', kind: 'cancel', outcome: 'refused', code: 'VALIDATION_ERROR' });
    expect(r.results.filter((x) => x.outcome === 'saved')).toHaveLength(39);
    const odd = await h.svc.batch(GRADE, { device: DEV, items: [{ kind: 'weird', id: 7 }, null] });
    expect(odd.results).toEqual([
      expect.objectContaining({ id: '', kind: 'action', outcome: 'refused', code: 'VALIDATION_ERROR' }),
      expect.objectContaining({ id: '', kind: 'action', outcome: 'refused', code: 'VALIDATION_ERROR' })]);
  });

  it('a mixed batch: one result per item, in order; a refusal does not stop the next', async () => {
    const h = await setup();
    const pend = checkIn(P_TOM);
    await enq(h.svc, GRADE, pend, DEV);
    const a = checkIn(P_AMY), dup = checkIn(P_AMY), bad = checkIn(P_OLD), undoNew = nid(), ident = nid();
    const r = await h.svc.batch(GRADE, { device: DEV, items: [
      { kind: 'action', ...a },
      { kind: 'action', ...dup },
      { kind: 'cancel', id: a.id, leaderId: null },
      { kind: 'undo', id: pend.id, leaderId: null, newId: undoNew },
      { kind: 'identity', id: ident, at: NOW.toISOString(), from: L_CODY, to: L_DANA },
      { kind: 'action', ...bad },
      { kind: 'action', ...checkIn(P_BEN) },
    ] });
    expect(r.results.map((x) => [x.kind, x.outcome])).toEqual([['action', 'saved'], ['action', 'duplicate'],
      ['cancel', 'cancelled'], ['undo', 'cancelled'], ['identity', 'logged'], ['action', 'refused'], ['action', 'saved']]);
    expect(r.results[1]).toMatchObject({ id: dup.id, existingId: a.id });
    expect(r.results[5]).toMatchObject({ id: bad.id, code: 'BAD_REQUEST' });
    for (const x of r.results) expect(x).not.toHaveProperty('httpStatus');
  });

  it('a DB error on item 3 fails the whole call 503; the replay gives replay for items 1–2', async () => {
    const h = await setup();
    const items = [checkIn(P_AMY), checkIn(P_BEN), checkIn(P_TOM)].map((x) => ({ kind: 'action', ...x }));
    const orig = h.link.insertAction.bind(h.link);
    let n = 0;
    h.link.insertAction = async (row) => { if (++n === 3) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); return orig(row); };
    const e = await h.svc.batch(GRADE, { device: DEV, items }).catch((x: { code: string; statusCode: number }) => x);
    expect(e).toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    const r = await h.svc.batch(GRADE, { device: DEV, items });
    expect(r.results.map((x) => x.outcome)).toEqual(['replay', 'replay', 'saved']);
  });

  const ft = (i: number) => ({ kind: 'action', ...firstTimer(),
    payload: { serviceTimeId: ST, serviceId: SVC, firstName: 'New', lastName: `Kid${i}`, grade: 8, gender: 'male' } });

  it('A8 / APP-7: a TypeError in one item refuses that item alone (INTERNAL), logs name/message/stack, never the body', async () => {
    const h = await setup();
    const items = [ft(1), ft(2), ft(3)];
    const orig = h.link.getAction.bind(h.link);
    h.link.getAction = async (id) => { if (id === items[1]!.id) throw new TypeError('x is undefined'); return orig(id); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await h.svc.batch(GRADE, { device: DEV, items });
    expect(r.results.map((x) => x.outcome)).toEqual(['saved', 'refused', 'saved']);
    expect(r.results[1]).toMatchObject({ code: 'INTERNAL' });
    const logged = JSON.stringify(err.mock.calls);
    err.mockRestore();
    expect(logged).toContain('TypeError');
    expect(logged).toContain('x is undefined');
    expect(logged).not.toContain('Kid2');
    const log = await h.link.listLog({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', limit: 50 });
    expect(log.map((l) => l.outcome).sort()).toEqual(['refused:INTERNAL', 'saved', 'saved']);
  });

  it('A8 / APP-7: a DB blip on item 30 of 40 → 503, and the 29 log rows already collected are written first', async () => {
    const h = await setup();
    const items = Array.from({ length: 40 }, (_, i) => ft(i));
    const orig = h.link.insertAction.bind(h.link);
    let n = 0;
    h.link.insertAction = async (row) => { if (++n === 30) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); return orig(row); };
    const e = await h.svc.batch(GRADE, { device: DEV, items }).catch((x: { code: string; statusCode: number }) => x);
    expect(e).toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    const range = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', limit: 100 };
    expect((await h.link.listLog(range)).filter((l) => l.outcome === 'saved')).toHaveLength(29);
    // The retry: 29 replays with their target filled from the stored row, then 11 saved.
    h.link.insertAction = orig;
    const r = await h.svc.batch(GRADE, { device: DEV, items });
    expect(r.results.filter((x) => x.outcome === 'replay')).toHaveLength(29);
    const replays = (await h.link.listLog(range)).filter((l) => l.outcome === 'replay');
    expect(replays).toHaveLength(29);
    for (const l of replays) expect(l).toMatchObject({ targetKind: 'person', targetName: expect.stringMatching(/^New Kid\d+$/) });
  });

  it('A8 / APP-72: two concurrent flushes of the same id → one saved, one replay, one row', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    const [r1, r2] = await Promise.all([h.svc.batch(GRADE, { device: DEV, items: [{ kind: 'action', ...a }] }),
      h.svc.batch(GRADE, { device: DEV, items: [{ kind: 'action', ...a }] })]);
    expect([r1.results[0]!.outcome, r2.results[0]!.outcome].sort()).toEqual(['replay', 'saved']);
    expect(await h.link.listActions({ ids: [a.id] })).toHaveLength(1);
  });

  it('A8 / APP-30: replay equality includes the note and the leader; a replay log row names the person', async () => {
    const h = await setup();
    const s = step({}, { note: 'first' });
    expect((await enq(h.svc, GRADE, s, DEV)).outcome).toBe('saved');
    expect((await enq(h.svc, GRADE, s, DEV)).outcome).toBe('replay');
    expect(await enq(h.svc, GRADE, { ...s, note: null }, DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_ID_REUSED' });
    expect(await enq(h.svc, GRADE, { ...s, leaderId: L_EVE }, DEV)).toMatchObject({ outcome: 'refused', code: 'LINK_ID_REUSED' });
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, DEV);
    await enq(h.svc, GRADE, a, DEV);
    const log = await h.link.listLog({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', limit: 50 });
    const rep = log.filter((l) => l.event === 'checkIn' && l.outcome === 'replay');
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ targetKind: 'person', targetId: P_AMY, targetName: 'Amy Adams', outboxId: a.id });
    const stepReplay = log.find((l) => l.event === 'completeStep' && l.outcome === 'replay')!;
    expect(stepReplay).toMatchObject({ targetKind: 'flowRow', targetId: FR1, targetName: 'Amy Adams', leaderId: L_DANA });
  });

  it('A8 / APP-71: a retried identity item writes one log row (log id = item id)', async () => {
    const h = await setup();
    const ident = { kind: 'identity', id: nid(), at: NOW.toISOString(), from: L_CODY, to: L_DANA };
    for (let i = 0; i < 3; i++) await h.svc.batch(GRADE, { device: DEV, items: [ident] });
    const log = await h.link.listLog({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', limit: 50 });
    expect(log.filter((l) => l.event === 'identity').map((l) => l.id)).toEqual([ident.id]);
  });

  it('log: one addLog per batch, one row per item, no note text', async () => {
    const h = await setup();
    const calls: unknown[][] = [];
    const orig = h.link.addLog.bind(h.link);
    h.link.addLog = async (rows) => { calls.push(rows); return orig(rows); };
    const a = checkIn(P_AMY, { leaderId: L_DANA }), s = step({}, { note: 'SECRET NOTE' }), rep = report({ date: '2026-10-15' });
    const refused = checkIn(P_OLD);
    await h.svc.batch(GRADE, { device: DEV, items: [
      { kind: 'action', ...a }, { kind: 'action', ...a }, { kind: 'action', ...checkIn(P_AMY) }, { kind: 'action', ...refused },
      { kind: 'action', ...s }, { kind: 'action', ...rep },
      { kind: 'cancel', id: s.id, leaderId: L_CODY },
      { kind: 'cancel', id: rep.id, leaderId: L_DANA },
      { kind: 'identity', id: nid(), at: NOW.toISOString(), from: L_CODY, to: L_DANA },
    ] });
    expect(calls).toHaveLength(1);
    const rows = calls[0] as Record<string, unknown>[];
    expect(rows.map((r) => `${r.event}:${r.outcome}`)).toEqual(['checkIn:saved', 'checkIn:replay', 'checkIn:duplicate',
      'checkIn:refused:BAD_REQUEST', 'completeStep:saved', 'submitReport:saved', 'cancel:refused:LINK_NOT_YOURS',
      'cancel:cancelled', 'identity:logged']);
    for (const r of rows) expect(r).toMatchObject({ userId: GRADE_ID, login: 'grade9g', deviceId: DEV.id, deviceLabel: DEV.label });
    expect(rows[0]).toMatchObject({ leaderId: L_DANA, leaderName: 'Dana Day', targetKind: 'person', targetId: P_AMY,
      targetName: 'Amy Adams', outboxId: a.id });
    expect(rows[2]).toMatchObject({ outboxId: a.id });
    expect(rows[4]).toMatchObject({ targetKind: 'flowRow', targetId: FR1, targetName: 'Amy Adams' });
    expect(rows[5]).toMatchObject({ targetKind: 'group', targetId: G9F, targetName: 'Grade 9 Girls' });
    expect(rows[7]).toMatchObject({ targetKind: 'action', targetId: rep.id });
    expect(rows[8]).toMatchObject({ prevLeaderId: L_CODY, prevLeaderName: 'Cody  Cobb', leaderId: L_DANA, leaderName: 'Dana Day' });
    expect(JSON.stringify(rows)).not.toContain('SECRET NOTE');
    expect(JSON.stringify(rows)).not.toContain('0400000000');
  });

  it('the single routes (enqueue, cancel, undo) write one log row each with the device given', async () => {
    const h = await setup();
    const a = checkIn(P_AMY);
    await enq(h.svc, GRADE, a, { id: 'hdr-dev', label: 'Pixel · Chrome' });
    await cancel(h.svc, GRADE, a.id, null, { id: 'hdr-dev', label: null });
    const log = await h.link.listLog({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', limit: 10 });
    expect(log.map((l) => `${l.event}:${l.outcome}:${l.deviceId}`).sort()).toEqual(['cancel:cancelled:hdr-dev', 'checkIn:saved:hdr-dev']);
  });
});

// =====================================================================================================================
describe('D5 lifegroups and flows', () => {
  it('scope: grade sees its grade+gender, quad its bracket+gender, ungraded for director/admin, junior leader none', async () => {
    const h = await setup();
    const ids = async (a: Actor) => (await h.svc.lifegroups(a)).groups.map((g) => g.groupId);
    expect(await ids(GRADE)).toEqual([G9F]);
    expect(await ids(GRADE2)).toEqual([]);
    expect(await ids(QUAD)).toEqual([G9F]);
    expect(await ids(QUAD_B)).toEqual([G10M]);
    expect((await ids(DIRECTOR)).sort()).toEqual([G9F, G10M, GX].sort());
    expect(await ids(LEADER)).toEqual([]);
  });

  it('row shape: defaultDate from meets, lastReport, openAction', async () => {
    const h = await setup();
    const open = report({ date: '2026-10-15' });
    await enq(h.svc, GRADE, open, DEV);
    const g = (await h.svc.lifegroups(GRADE)).groups[0]!;
    expect(Object.keys(g).sort()).toEqual(['defaultDate', 'gender', 'grade', 'groupId', 'history', 'lastReport', 'meets', 'members',
      'name', 'openAction', 'thisWeek']);
    expect(g).toMatchObject({ defaultDate: '2026-10-13', thisWeek: 'reported', lastReport: { reportId: R1, editable: true },
      openAction: { id: open.id, type: 'submitReport', status: 'pending', reason: null } });
    expect(JSON.stringify(g.lastReport)).not.toMatch(/note/i);
  });

  it('the overlay: newest sent submit with report_id after the groups push → lastReport, editable', async () => {
    const h = await setup();
    const sub = report({ date: '2026-10-15', guests: 3 });
    await enq(h.svc, GRADE, sub, DEV);
    const NEW_R = u(414);
    setRow(h.link, sub.id, { status: 'sent', result_at: '2026-10-16T08:45:00.000Z', report_id: NEW_R });
    const g = (await h.svc.lifegroups(GRADE)).groups[0]!;
    expect(g.lastReport).toMatchObject({ reportId: NEW_R, date: '2026-10-15', guests: 3, editable: true, blocked: null });
    expect(g.openAction).toBeNull();
    // a sent submit from before the push does not overlay
    setRow(h.link, sub.id, { result_at: '2026-10-16T07:45:00.000Z' });
    expect((await h.svc.lifegroups(GRADE)).groups[0]!.lastReport!.reportId).toBe(R1);
  });

  it('2026-10-14: a report carries who sent it from the app (by); one made in Elvanto has by null', async () => {
    const h = await setup();
    expect((await h.svc.lifegroups(GRADE)).groups[0]!.lastReport!.by).toBeNull();
    const sub = report({ date: '2026-10-13' });
    await enq(h.svc, GRADE, sub, DEV);
    setRow(h.link, sub.id, { status: 'sent', result_at: '2026-10-16T07:45:00.000Z', report_id: R1 }); // before the push: the mirror's R1 stays
    const g = (await h.svc.lifegroups(GRADE)).groups[0]!;
    expect(g.lastReport!.reportId).toBe(R1);
    expect(g.lastReport!.by).toEqual(expect.stringMatching(/\S/));
    expect(g.history.find((x) => x.reportId === R1)!.by).toBe(g.lastReport!.by);
  });

  it('T-27 / APP-29: the overlay is the newest sent submit OR edit, by report date then resultAt', async () => {
    const h = await setup();
    // submit D1 (newer date) sent, then an older-date submit D0 sent later: D1 stays the last report
    const s1 = report({ date: '2026-10-15', guests: 3 });
    const s0 = report({ date: '2026-10-14', guests: 7 });
    await enq(h.svc, GRADE, s1, DEV);
    await enq(h.svc, GRADE, s0, DEV);
    const R_S1 = u(415), R_S0 = u(416);
    setRow(h.link, s1.id, { status: 'sent', result_at: '2026-10-16T08:40:00.000Z', report_id: R_S1 });
    setRow(h.link, s0.id, { status: 'sent', result_at: '2026-10-16T08:50:00.000Z', report_id: R_S0 });
    let g = (await h.svc.lifegroups(GRADE)).groups[0]!;
    expect(g.lastReport).toMatchObject({ reportId: R_S1, date: '2026-10-15', guests: 3 });
    // an edit of D1 is sent: its values are the last report (same reportId), not the submit's
    const e1 = edit({ reportId: R_S1, date: '2026-10-15', guests: 5,
      base: { date: '2026-10-15', didNotMeet: false, attendees: [P_AMY], guests: 3, serviceTimeId: null } });
    expect((await enq(h.svc, DIRECTOR, e1, DEV)).outcome).toBe('saved');
    setRow(h.link, e1.id, { status: 'sent', result_at: '2026-10-16T08:55:00.000Z' });
    g = (await h.svc.lifegroups(GRADE)).groups[0]!;
    expect(g.lastReport).toMatchObject({ reportId: R_S1, date: '2026-10-15', guests: 5, attendees: [P_AMY, P_EVE1], editable: true });
    // a second edit is checked against the first edit's values
    const e2base = { date: '2026-10-15', didNotMeet: false, attendees: [P_AMY, P_EVE1], guests: 5, serviceTimeId: null };
    expect((await enq(h.svc, DIRECTOR, edit({ reportId: R_S1, date: '2026-10-15', guests: 6, base: e2base }), DEV)).outcome).toBe('saved');
  });

  it('flows: scoped by the roster grade/gender, unknown person for director/admin, ordered by flow then step', async () => {
    const h = await setup();
    const ids = async (a: Actor) => (await h.svc.flows(a)).rows.map((r) => r.rowId);
    expect(await ids(DIRECTOR)).toEqual([FR3, FR1, FR2]); // step 0 rows (FR0A, FR0B) are never listed (2026-10-14)
    expect(await ids(GRADE)).toEqual([FR1]);
    expect(await ids(QUAD_B)).toEqual([FR3]);
    expect(await ids(LEADER)).toEqual([]);
    const s = step();
    await enq(h.svc, GRADE, s, DEV);
    const r = (await h.svc.flows(GRADE)).rows[0]!;
    expect(r).toMatchObject({ rowId: FR1, flowId: FLOW_B, stepId: STEP1, flowName: 'Bravo', stepName: 'Welcome call',
      name: 'Amy Adams', personId: P_AMY, openAction: { id: s.id, type: 'completeStep', status: 'pending' } });
  });
});

// =====================================================================================================================
describe('B18 / T-8 an empty flows push', () => {
  it('after a push of [] the flows screen shows none', async () => {
    const h = await setup();
    expect((await h.svc.flows(ADMIN)).rows.length).toBeGreaterThan(0);
    await h.link.replaceMirror('flows', [], { takenAt: '2026-10-16T08:59:00.000Z', consoleId: CONSOLE });
    expect(await h.svc.flows(ADMIN)).toEqual({ rows: [] });
  });
});

describe('D6 admin: matching, shadow check, log', () => {
  let h: H;
  beforeEach(async () => { h = await setup(); });

  it('rosterForMatching: rows + candidates (same name key or same last name)', async () => {
    const r = await h.svc.rosterForMatching(ADMIN, { match: 'none' });
    expect(r.rows.every((x) => x.match === 'none')).toBe(true);
    const ben = r.rows.find((x) => x.personId === P_BEN)!;
    expect(ben.candidates).toEqual([{ studentId: S_BEN, name: 'Ben Brown', grade: 9, dob: '2011-05-01' }]);
    expect(r.rows.find((x) => x.personId === P_EVE1)!.candidates).toEqual([]);
  });

  it('A6 / APP-40: only student rows that still need a match; candidates only for none/ambiguous; no unused fields', async () => {
    const all = (await h.svc.rosterForMatching(ADMIN, {})).rows;
    expect(all.map((x) => x.personId).sort()).toEqual([P_BEN, P_EVE1, P_EVE2, P_TOM].sort()); // no auto, leader or other
    expect(all.some((x) => x.match === 'auto')).toBe(false);
    for (const x of all) {
      expect(Object.keys(x).sort()).toEqual(['active', 'candidates', 'grade', 'kind', 'match', 'name', 'personId', 'studentId']);
      for (const c of x.candidates) expect(Object.keys(c).sort()).toEqual(['dob', 'grade', 'name', 'studentId']);
    }
    expect(all.find((x) => x.personId === P_TOM)!.candidates).toEqual([]); // manual: no candidates computed
  });

  it('A6 / APP-11 B: an inactive holder is listed and released by setMatch', async () => {
    // P_OLD (inactive) holds S_BEN by hand; the new profile P_BEN must still be matchable.
    await h.link.setMatches([{ personId: P_OLD, studentId: S_BEN, match: 'manual' }]);
    const held = (await h.svc.rosterForMatching(ADMIN, { match: 'manual' })).rows.find((x) => x.personId === P_OLD)!;
    expect(held).toMatchObject({ active: false, studentId: S_BEN, match: 'manual' });
    expect(await h.svc.setMatch(ADMIN, P_BEN, { studentId: S_BEN })).toEqual({ personId: P_BEN, studentId: S_BEN, match: 'manual' });
    const roster = await h.link.roster();
    expect(roster.find((r) => r.personId === P_OLD)).toMatchObject({ studentId: null, match: 'none' });
    expect(roster.find((r) => r.personId === P_BEN)).toMatchObject({ studentId: S_BEN, match: 'manual' });
    // An inactive holder can also be cleared directly.
    await h.link.setMatches([{ personId: P_BEN, studentId: null, match: 'none' }, { personId: P_OLD, studentId: S_BEN, match: 'manual' }]);
    expect(await h.svc.setMatch(ADMIN, P_OLD, { studentId: null })).toMatchObject({ studentId: null, match: 'none' });
  });

  it('setMatch: manual / none / ignored; a student matched to another person → 409', async () => {
    expect(await h.svc.setMatch(ADMIN, P_BEN, { studentId: S_BEN })).toEqual({ personId: P_BEN, studentId: S_BEN, match: 'manual' });
    expect(await h.svc.setMatch(ADMIN, P_BEN, { studentId: null })).toMatchObject({ studentId: null, match: 'none' });
    expect(await h.svc.setMatch(ADMIN, P_BEN, { studentId: null, ignore: true })).toMatchObject({ match: 'ignored' });
    expect(await code(h.svc.setMatch(ADMIN, P_BEN, { studentId: S_AMY }))).toBe('CONFLICT');
    expect(await code(h.svc.setMatch(ADMIN, u(990), { studentId: null }))).toBe('NOT_FOUND');
    const roster = await h.link.roster();
    expect(roster.find((r) => r.personId === P_BEN)).toMatchObject({ match: 'ignored', studentId: null });
  });

  it('shadowCheck: no service_sessions row → "Not in the import"', async () => {
    expect(await h.svc.shadowCheck(ADMIN, TODAY)).toEqual({ date: TODAY, imported: false, rows: [], unlinkedAttenders: 0 });
  });

  it('shadowCheck: verdicts for sent/shadowed check-ins, plus imported attenders with no link row', async () => {
    await h.sessions.save({ id: 'sess1', importId: null, sessionDate: TODAY, sessionName: 'Youth', isRegular: true,
      isValid: true, totalAttendance: 3, sortOrder: 0, createdAt: T0 });
    await h.attendance.saveMany([{ studentId: S_AMY, sessionId: 'sess1', attended: true },
      { studentId: S_BEN, sessionId: 'sess1', attended: true }, { studentId: 'other', sessionId: 'sess1', attended: false }]);
    await h.link.setMatches([{ personId: P_BEN, studentId: S_BEN, match: 'manual' }]);
    const mk = async (person: string, status: string) => {
      const it = checkIn(person); await enq(h.svc, ADMIN, it, DEV); setRow(h.link, it.id, { status }); return it.id;
    };
    const amy = await mk(P_AMY, 'sent');        // attended → matched
    const tom = await mk(P_TOM, 'sent');        // not attended → sent-not-imported
    const eve = await mk(P_EVE1, 'shadowed');   // no student → no-student
    const cody = await mk(P_CODY, 'pending');   // pending: not checked
    const r = await h.svc.shadowCheck(ADMIN, TODAY);
    expect(r.imported).toBe(true);
    const v = Object.fromEntries(r.rows.map((x) => [x.id, x.verdict]));
    expect(v).toEqual({ [amy]: 'matched', [tom]: 'sent-not-imported', [eve]: 'no-student' });
    expect(r.rows.every((x) => !('message' in x))).toBe(true); // APP-41: the SPA words the verdict
    expect(r.unlinkedAttenders).toBe(1); // Ben attended, no link row
    expect(cody).toBeTruthy();
    // practice verdicts
    const ben = checkIn(P_BEN); await enq(h.svc, ADMIN, ben, DEV); setRow(h.link, ben.id, { status: 'shadowed' });
    setRow(h.link, tom, { status: 'shadowed' });
    const r2 = await h.svc.shadowCheck(ADMIN, TODAY);
    const v2 = Object.fromEntries(r2.rows.map((x) => [x.id, x.verdict]));
    expect(v2[ben.id]).toBe('practice-matched');
    expect(v2[tom]).toBe('practice-missing');
    expect(r2.unlinkedAttenders).toBe(0);
  });

  it('log: newest first, filters from/to/login/event, max 2,000', async () => {
    const at = (iso: string) => ({ id: nid(), at: iso, userId: GRADE_ID, login: 'grade9g', deviceId: null, deviceLabel: null,
      event: 'checkIn' as const, leaderId: null, leaderName: null, prevLeaderId: null, prevLeaderName: null, targetKind: null,
      targetId: null, targetName: null, outboxId: null, outcome: 'saved' });
    await h.link.addLog([at('2026-10-15T10:00:00.000Z'), at('2026-10-16T05:00:00.000Z'), at('2026-10-01T05:00:00.000Z'),
      { ...at('2026-10-16T06:00:00.000Z'), userId: QUAD_ID, login: 'g79', event: 'identity' }]);
    const all = await h.svc.log(ADMIN, {});
    expect(all.rows.map((r) => r.at)).toEqual(['2026-10-16T06:00:00.000Z', '2026-10-16T05:00:00.000Z', '2026-10-15T10:00:00.000Z']);
    expect((await h.svc.log(ADMIN, { login: 'g79' })).rows.map((r) => r.login)).toEqual(['g79']);
    expect((await h.svc.log(ADMIN, { event: 'checkIn' })).rows).toHaveLength(2);
    expect((await h.svc.log(ADMIN, { from: '2026-10-01', to: '2026-10-01' })).rows).toHaveLength(1);
    expect((await h.svc.log(ADMIN, { login: 'nobody' })).rows).toEqual([]);
    await h.link.addLog(Array.from({ length: 2005 }, () => at('2026-10-14T05:00:00.000Z')));
    expect((await h.svc.log(ADMIN, {})).rows).toHaveLength(2000);
  });
});

// =====================================================================================================================
describe('UX batch 2026-10-12 (lane Y1)', () => {
  const META = (takenAt = '2026-10-16T08:30:00.000Z') => ({ takenAt, consoleId: CONSOLE });

  it('T1: status carries consoleLinkRev (null before any console) and appLinkRev', async () => {
    const h = await setup();
    expect(await h.svc.status(ADMIN)).toMatchObject({ consoleLinkRev: 1, appLinkRev: 4 });
    await registerConsole(h.link, CONSOLE, CAPS, 60, 2);
    expect((await h.svc.status(GRADE)).consoleLinkRev).toBe(2);
    const none = await setup('on', { console: false });
    expect(await none.svc.status(ADMIN)).toMatchObject({ consoleLinkRev: null, appLinkRev: 4 });
  });

  it('T3: a checked-in person with no roster row is listed by the pushed name (leader by room name); no name, not listed', async () => {
    const h = await setup();
    const P_NEW = u(150), P_LEAD = u(151), P_ANON = u(152), LROOM = u(222);
    await h.link.replaceMirror('services', [{ serviceTimeId: ST, serviceId: SVC, name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z',
      ymd: TODAY, rooms: [{ id: ROOM, name: 'Youth Program' }, { id: LROOM, name: 'Kids/Youth Leaders' }],
      checkedIn: [{ personId: P_BEN, roomId: ROOM, firstName: 'Ben', lastName: 'Brown' },
        { personId: P_NEW, roomId: ROOM, firstName: 'Zed', lastName: 'Zulu' },
        { personId: P_LEAD, roomId: LROOM, firstName: 'Lee', lastName: 'Avery' },
        { personId: P_ANON, roomId: ROOM }] }], META('2026-10-16T08:59:00.000Z'));
    const people = (await h.svc.checkin(GRADE, ST)).people!;
    expect(people.map((p) => p.name)).toEqual(['Amy Adams', 'Lee Avery', 'Ben Brown', 'Cody Cobb', 'Eve Evans', 'Eve Evans', 'Tom Ten', 'Zed Zulu']);
    expect(people.find((p) => p.personId === P_NEW)).toEqual({ personId: P_NEW, name: 'Zed Zulu', grade: null, leader: false,
      checkedIn: true, action: null, mine: false, noRoster: true });
    expect(people.find((p) => p.personId === P_LEAD)!.leader).toBe(true);
    expect(people.some((p) => p.personId === P_ANON)).toBe(false);
  });

  it('T4: flow rows carry grade, gender, mobile, mobileIsParent and the assignee', async () => {
    const h = await setup();
    const r = (await h.svc.flows(ADMIN)).rows.find((x) => x.rowId === FR1)!;
    expect(Object.keys(r).sort()).toEqual(['assignedLeaderId', 'assignedLeaderName', 'assignedTo', 'due', 'flowId', 'flowName',
      'gender', 'grade', 'mobile', 'mobileIsParent', 'name', 'openAction', 'personId', 'rowId', 'stepId', 'stepName', 'stepOrder']);
    expect(r).toMatchObject({ grade: null, gender: null, mobile: null, mobileIsParent: false, assignedLeaderId: null, assignedLeaderName: null });
  });

  it('T4: visibility uses the own grade/gender of the row first, then the roster; step 0 (the 7-day wait) is never listed', async () => {
    const h = await setup();
    const ids = async (a: Actor) => (await h.svc.flows(a)).rows.map((r) => r.rowId);
    expect(await ids(GRADE2)).toEqual([]);                    // Ben (9 boy) sits in the step 0 of Bravo
    expect(await ids(ADMIN)).not.toContain(FR0B);             // 2026-10-14: Intake screen only, even for admin
    expect(await ids(DIRECTOR)).not.toContain(FR0B);
    const flows = await h.link.flows();
    const P_UNK = u(160);
    await h.link.replaceMirror('flows', [
      ...flows.map((f) => (f.rowId === FR1 ? { ...f, grade: 10, gender: 'male' } : f)), // the row of Amy says Year 10 boy
      { rowId: u(506), flowId: FLOW_B, flowName: 'Bravo', stepId: STEP1, stepName: 'Welcome call', stepOrder: 2, personId: P_UNK,
        name: 'Una Known', due: null, assignedTo: '', grade: 9, gender: 'female', mobile: '0411111111', mobileIsParent: true },
    ], META('2026-10-16T08:59:00.000Z'));
    expect(await ids(GRADE)).toEqual([u(506)]);               // not in the roster, but its own grade/gender match
    expect(await ids(QUAD_B)).toEqual([FR3, FR1]);
    expect((await h.svc.flows(GRADE)).rows[0]).toMatchObject({ grade: 9, gender: 'female', mobile: '0411111111', mobileIsParent: true });
  });

  it('T4: a step-0 row cannot be completed by any login (it moves on its own)', async () => {
    const h = await setup();
    const s = step({ rowId: FR0B, flowId: FLOW_B, stepId: STEP0B, personId: P_BEN });
    expect((await enq(h.svc, GRADE2, s, DEV)).code).toBe('FORBIDDEN');
    expect((await enq(h.svc, DIRECTOR, { ...s, id: nid() }, DEV)).code).toBe('FORBIDDEN');
    expect((await enq(h.svc, ADMIN, { ...s, id: nid() }, DEV)).code).toBe('FORBIDDEN');
  });

  it('T6: assign, reassign and unassign a flow person; rows carry the leader id and name', async () => {
    const h = await setup();
    const row = async (a: Actor) => (await h.svc.flows(a)).rows.find((r) => r.rowId === FR1)!;
    expect(await h.svc.assignFlow(GRADE, { flowId: FLOW_B, personId: P_AMY, leaderId: L_DANA })).toEqual({ ok: true });
    expect(await row(GRADE)).toMatchObject({ assignedLeaderId: L_DANA, assignedLeaderName: 'Dana Day' });
    expect((await h.link.flowAssignments())[0]).toMatchObject({ assignedBy: 'grade9g' });
    await h.svc.assignFlow(ADMIN, { flowId: FLOW_B, personId: P_AMY, leaderId: L_EVE });
    expect(await row(ADMIN)).toMatchObject({ assignedLeaderId: L_EVE, assignedLeaderName: 'Eve Evans' });
    await h.svc.assignFlow(GRADE, { flowId: FLOW_B, personId: P_AMY, leaderId: null });
    expect(await row(GRADE)).toMatchObject({ assignedLeaderId: null, assignedLeaderName: null });
  });

  it('T6: 404 module off, 403 outside scope or step 0, 400 unknown/inactive leader or no such person', async () => {
    const h = await setup();
    const a = (actor: Actor, b: object) => code(h.svc.assignFlow(actor, { flowId: FLOW_B, personId: P_AMY, leaderId: L_DANA, ...b }));
    expect(await a(GRADE2, {})).toBe('FORBIDDEN');                            // Amy is a Year 9 girl
    expect(await a(GRADE, { personId: P_BEN })).toBe('FORBIDDEN');            // Ben: step 0
    expect(await a(GRADE, { leaderId: u(399) })).toBe('BAD_REQUEST');         // unknown leader
    expect(await a(GRADE, { leaderId: L_FAY })).toBe('BAD_REQUEST');          // inactive leader
    expect(await a(GRADE, { personId: P_TOM })).toBe('BAD_REQUEST');          // not in this flow
    expect(await a(GRADE, { personId: null })).toBe('VALIDATION_ERROR');      // a row with no person cannot be assigned
    const off = await setup({ checkin: 'on', lifegroupReport: 'on' });
    expect(await code(off.svc.assignFlow(GRADE, { flowId: FLOW_B, personId: P_AMY, leaderId: L_DANA }))).toBe('MODULE_DISABLED');
  });

  it('T8: lifegroups carry grade, gender and history (overlay first), sorted 6..12, girls then boys, no grade last', async () => {
    const h = await setup();
    const gs0 = await h.link.groups();
    const lr = gs0.find((g) => g.groupId === G9F)!.lastReport!;
    const old = { ...lr, reportId: u(417), date: '2026-10-06' };
    await h.link.replaceMirror('groups', [...gs0.map((g) => (g.groupId === G9F ? { ...g, history: [lr, old] } : g)),
      group({ groupId: u(431), name: 'Grade 9 Boys', meets: '', members: [], thisWeek: 'none', lastReport: null }),
      group({ groupId: u(432), name: 'Grade 7 Girls', meets: '', members: [], thisWeek: 'none', lastReport: null }),
      group({ groupId: u(433), name: 'Grade 6 Boys', meets: '', members: [], thisWeek: 'none', lastReport: null }),
      group({ groupId: u(434), name: 'Grade 6 Girls', meets: '', members: [], thisWeek: 'none', lastReport: null }),
    ], META('2026-10-16T08:30:00.000Z'));
    const r = await h.svc.lifegroups(DIRECTOR);
    expect(r.groups.map((g) => g.name)).toEqual(['Grade 6 Girls', 'Grade 6 Boys', 'Grade 7 Girls', 'Grade 9 Girls', 'Grade 9 Boys',
      'Grade 10 Boys', 'Connect group']);
    const g9 = r.groups.find((g) => g.groupId === G9F)!;
    expect(g9).toMatchObject({ grade: 9, gender: 'female' });
    expect(g9.history.map((x) => x.reportId)).toEqual([R1, u(417)]);
    expect(r.groups.find((g) => g.groupId === GX)!.history).toEqual([]);
    // a report sent after the push leads the history
    const sub = report({ date: '2026-10-15', guests: 3 });
    await enq(h.svc, GRADE, sub, DEV);
    setRow(h.link, sub.id, { status: 'sent', result_at: '2026-10-16T08:45:00.000Z', report_id: u(418) });
    expect((await h.svc.lifegroups(GRADE)).groups[0]!.history.map((x) => x.reportId)).toEqual([u(418), R1, u(417)]);
  });
});

// =====================================================================================================================
describe('RFIX (review of the UX batch)', () => {
  const META = (takenAt = '2026-10-16T08:30:00.000Z') => ({ takenAt, consoleId: CONSOLE });

  it('T8: an older week can be edited (the 14-day rule is for submit only); submit still stops at 14 days', async () => {
    const h = await setup();
    const OLD = u(419), NEWER = u(420);
    const oldRep = { reportId: OLD, date: '2026-09-22', time: '18:30', didNotMeet: false, attendees: [P_AMY], guests: 0,
      serviceTimeId: null, editable: true, blocked: null };
    const gs = await h.link.groups();
    await h.link.replaceMirror('groups', gs.map((g) => (g.groupId === G9F
      ? { ...g, history: [g.lastReport!, { ...oldRep, reportId: NEWER, date: '2026-10-06' }, oldRep] } : g)), META('2026-10-16T08:59:00.000Z'));
    const oldEdit = edit({ reportId: OLD, date: '2026-09-22', attendees: [P_AMY, P_EVE1], guests: 0,
      base: { date: '2026-09-22', didNotMeet: false, attendees: [P_AMY], guests: 0, serviceTimeId: null } });
    expect((await enq(h.svc, DIRECTOR, oldEdit, DEV)).outcome).toBe('saved');
    expect((await enq(h.svc, DIRECTOR, report({ date: '2026-09-22' }), DEV)).code).toBe('BAD_REQUEST'); // submit: still 14 days
    // a report that is nowhere in the group is still refused
    expect((await enq(h.svc, DIRECTOR, edit({ reportId: u(999) }), DEV)).code).toBe('BAD_REQUEST');
  });

  it('T8: an older report whose base differs is refused as changed', async () => {
    const h = await setup();
    const OLD = u(419);
    const gs = await h.link.groups();
    await h.link.replaceMirror('groups', gs.map((g) => (g.groupId === G9F ? { ...g, history: [g.lastReport!, { ...g.lastReport!, reportId: OLD, date: '2026-10-06' }] } : g)),
      META('2026-10-16T08:59:00.000Z'));
    const bad = edit({ reportId: OLD, date: '2026-10-06', base: { date: '2026-10-06', didNotMeet: false, attendees: [P_AMY], guests: 5, serviceTimeId: null } });
    expect((await enq(h.svc, DIRECTOR, bad, DEV)).code).toBe('BAD_REQUEST');
  });

  it('T3: a checked-in person with no roster row can be checked out, never checked in; strangers are refused', async () => {
    const h = await setup();
    const P_NEW = u(150), P_STR = u(153);
    await h.link.replaceMirror('services', [{ serviceTimeId: ST, serviceId: SVC, name: 'Youth', startsAt: '2026-10-16T08:30:00.000Z',
      ymd: TODAY, rooms: [{ id: ROOM, name: 'Youth Program' }],
      checkedIn: [{ personId: P_NEW, roomId: ROOM, firstName: 'Zed', lastName: 'Zulu' }] }], META('2026-10-16T08:59:00.000Z'));
    const v = (await h.svc.checkin(GRADE, ST)).people!.find((p) => p.personId === P_NEW)!;
    expect(v).toMatchObject({ checkedIn: true, noRoster: true });
    expect((await h.svc.checkin(GRADE, ST)).people!.find((p) => p.personId === P_AMY)).not.toHaveProperty('noRoster');
    expect((await enq(h.svc, GRADE, checkOut(P_NEW), DEV)).outcome).toBe('saved');
    expect((await enq(h.svc, GRADE, checkIn(P_NEW), DEV)).code).toBe('BAD_REQUEST');
    expect((await enq(h.svc, GRADE, checkOut(P_STR), DEV)).code).toBe('BAD_REQUEST'); // not on the roster, not checked in
  });

  it('T6: assignFlow only takes a leader the login could pick in its "I am" list (gender scope)', async () => {
    const h = await setup();
    const a = (actor: Actor, leaderId: string) => code(h.svc.assignFlow(actor, { flowId: FLOW_B, personId: P_AMY, leaderId }));
    expect(await a(GRADE, L_CODY)).toBe('BAD_REQUEST');   // Cody is male; GRADE is a girls login
    expect(await a(GRADE, L_DANA)).toBe('ok');
    expect(await a(ADMIN, L_CODY)).toBe('ok');            // admin picks anyone
  });
});
