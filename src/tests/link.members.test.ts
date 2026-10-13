// UX batch 2026-10-13 T5/T6: lifegroup members list + add/remove member (contract X18). Service, rules and RBAC.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeLinkService } from '../services/link.service';
import { canEditGroupMembers } from '../services/access-control';
import { dedupeKey, effectiveMembers } from '../services/link-rules';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { Capabilities, OutboxRow } from '../core/link-types';
import { parseGroupName } from '../services/import.service';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-16T09:00:00.000Z');
const T0 = '2026-10-01T00:00:00.000Z';
const ADMIN_ID = u(1), DIR_ID = u(2), GRADE_ID = u(4), QB_ID = u(7);
const P_AMY = u(101), P_BEA = u(102), P_DANA = u(103), P_TOM = u(104), P_PAT = u(105), P_ZOE = u(106);
const L_DANA = u(301), L_EVE = u(302);
const G9F = u(401);
const CONSOLE = u(601);
const S_AMY = u(701), S_TOM = u(703);

const actor = (id: string, role: string, o: Partial<Actor> = {}): Actor =>
  ({ id, role: role as Actor['role'], displayName: `${role} login`, grade: null, quad: null, gender: null, leaderId: null, ...o });
const ADMIN = actor(ADMIN_ID, 'admin');
const DIRECTOR = actor(DIR_ID, 'director');
const GRADE = actor(GRADE_ID, 'grade', { grade: 9, gender: 'female' });
const QUAD_B = actor(QB_ID, 'quad', { quad: 'b1012' });
const CAPS: Capabilities = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live',
  firstTimerCheckIn: 'live', addGroupMember: 'live', removeGroupMember: 'live' };
const OLD_CAPS: Capabilities = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live',
  firstTimerCheckIn: 'live' };

let idn = 9000;
const nid = () => u(++idn);
const student = (id: string, first: string, last: string, gender: 'male' | 'female', grade: number) => ({
  id, firstName: first, lastName: last, gender, grade, quad: null, mobile: '0400000000', parentPhone: '0400000001',
  dateOfBirth: '2011-05-01', svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
  prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0, atRiskStatus: null, dataSource: null,
  createdAt: T0, updatedAt: T0,
});
const claimArgs = (capabilities: Capabilities, max = 5) => ({ console: { consoleId: CONSOLE, label: 'PC', contractVersion: 1,
  consoleVersion: '1', inWindow: true, pollSeconds: 60, capabilities, linkRev: 3 }, max, leaseSeconds: 180, cutoffDays: 3,
  leaseLostMs: 3_600_000 });

async function setup(o: { caps?: Capabilities | null } = {}) {
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
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'on' } } } as never);
  for (const [id, email, role] of [[ADMIN_ID, 'admin', 'admin'], [DIR_ID, 'director', 'director'], [GRADE_ID, 'grade9g', 'grade'],
    [QB_ID, 'b1012', 'quad']] as const) {
    await users.save({ id, email, displayName: email, role, status: 'active', createdAt: T0, updatedAt: T0 } as never);
  }
  await students.save(student(S_AMY, 'Amy', 'Adams', 'female', 9) as never);
  await students.save(student(S_TOM, 'Tom', 'Ten', 'male', 10) as never);
  for (const [id, fullName] of [[L_DANA, 'Dana Day'], [L_EVE, 'Eve Evans']]) {
    await leaders.save({ id, fullName, gender: 'female', grades: [], active: true, createdByGrade: null, smsTemplate: null,
      createdAt: T0, updatedAt: T0 } as never);
  }
  const meta = (takenAt: string) => ({ takenAt, consoleId: CONSOLE });
  const person = (personId: string, firstName: string, lastName: string, gender: 'male' | 'female' | null, grade: number | null,
    kind: 'student' | 'leader' | 'other') => ({ personId, firstName, lastName, gender, grade, kind });
  await link.replaceMirror('roster', [person(P_AMY, 'Amy', 'Adams', 'female', 9, 'student'),
    person(P_BEA, 'Bea', 'Bell', 'female', 9, 'student'), person(P_DANA, 'Dana', 'Day', 'female', null, 'leader'),
    person(P_TOM, 'Tom', 'Ten', 'male', 10, 'student'), person(P_PAT, 'Pat', 'Parent', 'female', null, 'other'),
    person(P_ZOE, 'Zoe', 'Zed', 'female', 11, 'student')], meta('2026-10-16T08:00:00.000Z'));
  await link.setMatches([{ personId: P_AMY, studentId: S_AMY, match: 'auto' }, { personId: P_TOM, studentId: S_TOM, match: 'manual' }]);
  await link.replaceMirror('groups', [{ groupId: G9F, name: 'Grade 9 Girls', meets: 'Tue 6:30 PM', thisWeek: 'none', lastReport: null,
    history: [], members: [{ personId: P_AMY, name: 'Amy Adams', leader: false }, { personId: P_TOM, name: 'Tom Ten', leader: false },
      { personId: P_DANA, name: 'Dana Day', leader: true }], ...parseGroupName('Grade 9 Girls') }], meta('2026-10-16T08:00:00.000Z'));
  if (o.caps !== null) await link.claim(claimArgs(o.caps ?? CAPS, 0));
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: { isBlocked: () => false }, now: () => clock.now });
  return { svc, link, clock };
}

type H = Awaited<ReturnType<typeof setup>>;
const act = (type: 'addGroupMember' | 'removeGroupMember', personId: string, leaderId: string | null = L_DANA, id = nid()) =>
  ({ kind: 'action', id, type, payload: { groupId: G9F, personId }, leaderId });
const one = async (h: H, a: Actor, item: object) => (await h.svc.batch(a, { items: [item] })).results[0]!;

describe('T6 rules', () => {
  it('canEditGroupMembers: admin and director always; others only as a leader of the group', () => {
    expect(canEditGroupMembers(ADMIN, false)).toBe(true);
    expect(canEditGroupMembers(DIRECTOR, false)).toBe(true);
    expect(canEditGroupMembers(GRADE, false)).toBe(false);
    expect(canEditGroupMembers(GRADE, true)).toBe(true);
  });
  it('dedupe keys: one per type, group and person', () => {
    expect(dedupeKey('addGroupMember', { groupId: 'g', personId: 'p' })).toBe('addMember:g:p');
    expect(dedupeKey('removeGroupMember', { groupId: 'g', personId: 'p' })).toBe('removeMember:g:p');
  });
  it('effectiveMembers applies sent changes after the push, oldest first; earlier or unsent ones are ignored', () => {
    const row = (type: OutboxRow['type'], personId: string, status: OutboxRow['status'], resultAt: string | null) =>
      ({ type, status, resultAt, payload: { groupId: 'g', personId } }) as unknown as OutboxRow;
    const base = [{ personId: 'a', name: 'A', leader: false }, { personId: 'b', name: 'B', leader: false }];
    const out = effectiveMembers(base, [
      row('removeGroupMember', 'a', 'sent', '2026-10-16T09:00:00Z'),
      row('addGroupMember', 'c', 'sent', '2026-10-16T08:30:00Z'),
      row('removeGroupMember', 'c', 'sent', '2026-10-16T08:40:00Z'),
      row('addGroupMember', 'c', 'sent', '2026-10-16T08:50:00Z'),
      row('removeGroupMember', 'b', 'sent', '2026-10-16T07:00:00Z'), // before the push: the push already has it
      row('addGroupMember', 'd', 'pending', null),
    ], '2026-10-16T08:00:00Z', (p) => p.toUpperCase());
    expect(out).toEqual([{ personId: 'b', name: 'B', leader: false }, { personId: 'c', name: 'C', leader: false }]);
  });
});

describe('T5 GET /link/lifegroups/:groupId/members', () => {
  it('studentId only for a student this login may see; others are name + roster grade; never a phone', async () => {
    const h = await setup();
    const v = await h.svc.groupMembers(GRADE, G9F, {});
    expect(v.members).toEqual([
      { personId: P_AMY, name: 'Amy Adams', leader: false, grade: 9, studentId: S_AMY },
      { personId: P_TOM, name: 'Tom Ten', leader: false, grade: 10, studentId: null }, // grade 10 boy: not this login's
      { personId: P_DANA, name: 'Dana Day', leader: true, grade: null, studentId: null },
    ]);
    expect(JSON.stringify(v)).not.toMatch(/0400/);
    expect((await h.svc.groupMembers(ADMIN, G9F, {})).members[1]!.studentId).toBe(S_TOM);
  });
  it('canEdit: the group leader as "I am", admin, director; not another leader or no "I am"', async () => {
    const h = await setup();
    expect((await h.svc.groupMembers(GRADE, G9F, { leaderId: L_DANA })).canEdit).toBe(true);
    expect((await h.svc.groupMembers(GRADE, G9F, { leaderId: L_EVE })).canEdit).toBe(false);
    expect((await h.svc.groupMembers(GRADE, G9F, {})).canEdit).toBe(false);
    expect((await h.svc.groupMembers(ADMIN, G9F, {})).canEdit).toBe(true);
    expect((await h.svc.groupMembers(DIRECTOR, G9F, {})).canEdit).toBe(true);
  });
  it('a group out of scope is 403; an unknown one 404', async () => {
    const h = await setup();
    await expect(h.svc.groupMembers(QUAD_B, G9F, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.svc.groupMembers(ADMIN, u(999), {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('T6 GET /link/youth (picker)', () => {
  it('active youth (not other) in scope, name + grade only, A-Z by last name', async () => {
    const h = await setup();
    expect((await h.svc.youth(GRADE)).rows).toEqual([
      { personId: P_AMY, name: 'Amy Adams', grade: 9 }, { personId: P_BEA, name: 'Bea Bell', grade: 9 }]);
    expect((await h.svc.youth(ADMIN)).rows.map((r) => r.name)).toEqual(['Amy Adams', 'Bea Bell', 'Dana Day', 'Tom Ten', 'Zoe Zed']);
  });
});

describe('T6 enqueue addGroupMember / removeGroupMember', () => {
  it('the group leader ("I am") adds; the row carries the person; director needs no "I am"', async () => {
    const h = await setup();
    const r = await one(h, GRADE, act('addGroupMember', P_BEA));
    expect(r).toMatchObject({ outcome: 'saved', action: { type: 'addGroupMember', status: 'pending' } });
    expect((await h.link.getAction(r.id))!).toMatchObject({ personId: P_BEA, dedupeKey: `addMember:${G9F}:${P_BEA}`, note: null });
    expect((await one(h, DIRECTOR, act('removeGroupMember', P_TOM, null))).outcome).toBe('saved');
  });
  it('refused: no "I am", not a leader of the group, group out of scope, person out of scope', async () => {
    const h = await setup();
    expect(await one(h, GRADE, act('addGroupMember', P_BEA, null))).toMatchObject({ outcome: 'refused', code: 'BAD_REQUEST' });
    expect(await one(h, GRADE, act('addGroupMember', P_BEA, L_EVE))).toMatchObject({ outcome: 'refused', code: 'FORBIDDEN' });
    expect(await one(h, QUAD_B, act('addGroupMember', P_BEA))).toMatchObject({ outcome: 'refused', code: 'FORBIDDEN' });
    expect(await one(h, GRADE, act('addGroupMember', P_ZOE))).toMatchObject({ outcome: 'refused', code: 'FORBIDDEN' });
  });
  it('refused: already a member, an adult (other), removing a leader, removing a non-member, a note', async () => {
    const h = await setup();
    expect((await one(h, ADMIN, act('addGroupMember', P_AMY))).message).toBe('Already in this group.');
    expect((await one(h, ADMIN, act('addGroupMember', P_PAT))).message).toBe('This person is not on the youth list. Reload.');
    expect((await one(h, ADMIN, act('removeGroupMember', P_DANA))).message).toBe('Remove a leader in Elvanto.');
    expect((await one(h, ADMIN, act('removeGroupMember', P_BEA))).message).toBe('Not in this group now. Reload.');
    expect((await one(h, ADMIN, { ...act('addGroupMember', P_BEA), note: 'hi' })).outcome).toBe('refused');
  });
  it('the same change twice is a duplicate; the opposite while pending cancels it (a re-send replays the cancel)', async () => {
    const h = await setup();
    const add = await one(h, GRADE, act('addGroupMember', P_BEA));
    expect(await one(h, GRADE, act('addGroupMember', P_BEA))).toMatchObject({ outcome: 'duplicate', existingId: add.id });
    const rm = act('removeGroupMember', P_BEA);
    expect(await one(h, GRADE, rm)).toMatchObject({ outcome: 'cancelled', action: { id: add.id, status: 'cancelled' } });
    expect((await h.link.getAction(add.id))!.status).toBe('cancelled');
    expect(await one(h, GRADE, rm)).toMatchObject({ outcome: 'cancelled' });
    expect(await h.link.getAction(rm.id)).toBeNull();
  });
  it('the opposite while claimed: still sending', async () => {
    const h = await setup();
    await one(h, ADMIN, act('removeGroupMember', P_TOM));
    expect(await h.link.claim(claimArgs(CAPS))).toHaveLength(1);
    expect(await one(h, ADMIN, act('addGroupMember', P_TOM))).toMatchObject({ outcome: 'refused', code: 'LINK_STILL_SENDING' });
  });
  it('sent: the member list shows it before the next push, with the change; a later add of a removed member is allowed', async () => {
    const h = await setup();
    const add = await one(h, GRADE, act('addGroupMember', P_BEA));
    const rm = await one(h, GRADE, act('removeGroupMember', P_TOM));
    expect((await h.link.claim(claimArgs(CAPS))).map((c) => c.row.id).sort()).toEqual([add.id, rm.id].sort());
    await h.link.applyResults(CONSOLE, [{ id: add.id, outcome: 'sent', sentLogKey: 'k1' }, { id: rm.id, outcome: 'refused', reason: 'group-unknown' }],
      new Date('2026-10-16T09:01:00.000Z'));
    const v = await h.svc.groupMembers(GRADE, G9F, { leaderId: L_DANA });
    expect(v.members.map((m) => m.personId)).toEqual([P_AMY, P_TOM, P_DANA, P_BEA]);
    expect(v.changes.map((c) => [c.type, c.personId, c.status, c.reason])).toEqual(expect.arrayContaining([
      ['addGroupMember', P_BEA, 'sent', null], ['removeGroupMember', P_TOM, 'refused', 'group-unknown']]));
    expect((await one(h, GRADE, act('removeGroupMember', P_BEA))).outcome).toBe('saved');
  });
});

describe('T6 an older console (no member capabilities)', () => {
  it('new member changes are refused LINK_UNAVAILABLE', async () => {
    const h = await setup({ caps: OLD_CAPS });
    expect(await one(h, ADMIN, act('addGroupMember', P_BEA))).toMatchObject({ outcome: 'refused', code: 'LINK_UNAVAILABLE' });
  });
  it('a row queued before is never leased to it, and the sweep refuses it too-old after 3 days', async () => {
    const h = await setup({ caps: null }); // no console seen yet: queued
    const add = await one(h, ADMIN, act('addGroupMember', P_BEA));
    expect(add.outcome).toBe('saved');
    expect(await h.link.claim(claimArgs(OLD_CAPS))).toHaveLength(0);
    expect((await h.link.getAction(add.id))!.status).toBe('pending');
    h.clock.now = new Date(NOW.getTime() + 4 * 86_400_000);
    h.link._backdate('link_outbox', add.id, 'createdAt', '2026-10-12T00:00:00.000Z');
    await h.link.claim(claimArgs(OLD_CAPS));
    expect((await h.link.getAction(add.id))!).toMatchObject({ status: 'refused', reason: 'too-old' });
  });
});

describe('T6 migration 0020', () => {
  it('re-creates the link_outbox type check with every ACTION_TYPE before X19 (and nothing else)', async () => {
    const { ACTION_TYPES, INTAKE_TYPES } = await import('../core/link-contract');
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0020_link_group_members.sql'), 'utf8');
    expect(sql).toContain('drop constraint if exists link_outbox_type_check');
    const listed = [...sql.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(ACTION_TYPES.filter((t) => !(INTAKE_TYPES as readonly string[]).includes(t)).sort());
  });
});
