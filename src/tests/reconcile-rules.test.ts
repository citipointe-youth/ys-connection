import { describe, it, expect } from 'vitest';
import { checkCheckins, checkUnmatched, checkLifegroups, checkMembers, compareCheckIns } from '../services/reconcile-rules';
import type { LinkRosterRow, OutboxRow } from '../core/link-types';

type Act = Pick<OutboxRow, 'type' | 'status' | 'payload' | 'resultAt'>;

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const G1 = P(901), G2 = P(902);
const ros = (n: number, o: Partial<LinkRosterRow> = {}): LinkRosterRow => ({ personId: P(n), firstName: `F${n}`, lastName: `L${n}`,
  gender: null, grade: 9, kind: 'student', active: true, studentId: `s${n}`, match: 'auto', updatedAt: '2026-10-01T00:00:00Z', ...o });
const ci = (n: number, date: string, o: Record<string, unknown> = {}) =>
  ({ id: `a${n}${date}`, personId: P(n), studentId: null, status: 'sent' as const, serviceDate: date, ...o });

describe('check 1 check-ins', () => {
  const sessions = [{ id: 'ss1', sessionDate: '2026-10-23' }];
  const attendance = [{ sessionId: 'ss1', studentId: 's1', attended: true }];
  it('student sent but not imported is counted; matched is not', () => {
    const r = checkCheckins({ sessions, attendance, roster: [ros(1), ros(2)], rows: [ci(1, '2026-10-23'), ci(2, '2026-10-23')] });
    expect(r).toEqual({ count: 1, items: [{ personId: P(2), date: '2026-10-23' }] });
  });
  it('leader excluded', () => {
    const r = checkCheckins({ sessions, attendance, roster: [ros(3, { kind: 'leader' })], rows: [ci(3, '2026-10-23')] });
    expect(r.count).toBe(0);
  });
  it('no student id skipped (check 2 covers them)', () => {
    const r = checkCheckins({ sessions, attendance, roster: [ros(4, { studentId: null, match: 'none' })], rows: [ci(4, '2026-10-23')] });
    expect(r.count).toBe(0);
  });
  it('date with no imported session skipped', () => {
    const r = checkCheckins({ sessions, attendance, roster: [ros(2)], rows: [ci(2, '2026-10-16')] });
    expect(r.count).toBe(0);
  });
  it('same person and date counted once', () => {
    const r = checkCheckins({ sessions, attendance, roster: [ros(2)], rows: [ci(2, '2026-10-23'), ci(2, '2026-10-23', { id: 'dup' })] });
    expect(r.count).toBe(1);
  });
  it('compareCheckIns keeps the shadowCheck verdicts', () => {
    const v = compareCheckIns(new Set(['s1']), [ros(1)], [ci(1, 'd', { status: 'shadowed' })]);
    expect(v[0]?.verdict).toBe('practice-matched');
  });
});

describe('check 2 unmatched', () => {
  it('none and ambiguous counted; inactive, leaders and matched not', () => {
    const r = checkUnmatched([ros(1, { match: 'none', studentId: null }), ros(2, { match: 'ambiguous', studentId: null }),
      ros(3, { match: 'none', active: false }), ros(4, { match: 'none', kind: 'leader' }), ros(5)]);
    expect(r).toEqual({ count: 2, items: [P(1), P(2)] });
  });
});

const rep = (o: Record<string, unknown>, resultAt = '2026-10-20T08:00:00Z', type: Act['type'] = 'submitReport'): Act =>
  ({ type, status: 'sent', resultAt, payload: { groupId: G1, date: '2026-10-20', didNotMeet: false, attendees: [P(1)], ...o } });
const LG = [{ id: 'lg1', elvantoGroupId: G1 }, { id: 'lg2', elvantoGroupId: null }];
const weeks = [{ id: 'w1', weekKey: '2026-10-17' }];        // saturdayOf('2026-10-20', 5) = 2026-10-17
const base = { lifegroups: LG, weeks, roster: [ros(1), ros(2), ros(3, { kind: 'leader' })], today: '2026-10-23',
  sinceIso: '2026-10-09T00:00:00Z', beforeIso: '2026-10-23T11:15:00Z', serviceDayOfWeek: 5 };

describe('check 3 lifegroup reports', () => {
  it('matched by elvanto_group_id and week via saturdayOf: present attendee is fine', () => {
    const r = checkLifegroups({ ...base, actions: [rep({})], attendance: [{ weekId: 'w1', lifegroupId: 'lg1', studentId: 's1', attended: true }] });
    expect(r.count).toBe(0);
  });
  it('missing attendee counted; extra attender ignored', () => {
    const r = checkLifegroups({ ...base, actions: [rep({ attendees: [P(1), P(2)] })],
      attendance: [{ weekId: 'w1', lifegroupId: 'lg1', studentId: 's1', attended: true }, { weekId: 'w1', lifegroupId: 'lg1', studentId: 's9', attended: true }] });
    expect(r.items).toEqual([{ groupId: G1, date: '2026-10-20', personIds: [P(2)] }]);
  });
  it('week missing counts as missing; leaders skipped', () => {
    const r = checkLifegroups({ ...base, actions: [rep({ attendees: [P(1), P(3)] })], attendance: [] });
    expect(r.items[0]?.personIds).toEqual([P(1)]);
  });
  it('didNotMeet with an attended row is a mismatch; without is fine', () => {
    const dnm = rep({ didNotMeet: true, attendees: [] });
    expect(checkLifegroups({ ...base, actions: [dnm], attendance: [] }).count).toBe(0);
    expect(checkLifegroups({ ...base, actions: [dnm], attendance: [{ weekId: 'w1', lifegroupId: 'lg1', studentId: 's1', attended: true }] }).count).toBe(1);
  });
  it('group with no id skipped and counted in noId', () => {
    const r = checkLifegroups({ ...base, actions: [rep({ groupId: G2 })], attendance: [] });
    expect(r).toEqual({ count: 0, items: [], noId: ['lg2'] });
  });
  it('newest edit wins', () => {
    const r = checkLifegroups({ ...base, attendance: [{ weekId: 'w1', lifegroupId: 'lg1', studentId: 's1', attended: true }],
      actions: [rep({ attendees: [P(1), P(2)] }, '2026-10-20T08:00:00Z'), rep({ attendees: [P(1)] }, '2026-10-21T08:00:00Z', 'editReport')] });
    expect(r.count).toBe(0);
  });
  it('outside the window, after the import, or a future date is ignored', () => {
    const att: never[] = [];
    expect(checkLifegroups({ ...base, attendance: att, actions: [rep({}, '2026-10-01T00:00:00Z')] }).count).toBe(0);
    expect(checkLifegroups({ ...base, attendance: att, actions: [rep({}, '2026-10-23T12:00:00Z')] }).count).toBe(0);
    expect(checkLifegroups({ ...base, attendance: att, actions: [rep({ date: '2026-10-24' })] }).count).toBe(0);
  });
});

const mem = (op: 'add' | 'remove', n: number, resultAt = '2026-10-20T08:00:00Z', groupId = G1): Act =>
  ({ type: op === 'add' ? 'addGroupMember' : 'removeGroupMember', status: 'sent', resultAt, payload: { groupId, personId: P(n) } });
const mbase = { lifegroups: LG, roster: [ros(1), ros(2), ros(3, { kind: 'leader' })], keyOf: (r: LinkRosterRow) => `${r.firstName} ${r.lastName}`.toLowerCase(),
  sinceIso: '2026-10-09T00:00:00Z', beforeIso: '2026-10-23T11:15:00Z' };

describe('check 4 group members', () => {
  it('add found is fine, add missing counted', () => {
    const roll = [{ lifegroupId: 'lg1', nameKey: 'f1 l1' }];
    expect(checkMembers({ ...mbase, roll, actions: [mem('add', 1)] }).count).toBe(0);
    expect(checkMembers({ ...mbase, roll, actions: [mem('add', 2)] }).items).toEqual([{ groupId: G1, personId: P(2), op: 'add' }]);
  });
  it('remove still present counted; CHECK_REMOVALS=false ignores removes', () => {
    const roll = [{ lifegroupId: 'lg1', nameKey: 'f1 l1' }];
    expect(checkMembers({ ...mbase, roll, actions: [mem('remove', 1)] }).count).toBe(1);
    expect(checkMembers({ ...mbase, roll, actions: [mem('remove', 1)], checkRemovals: false }).count).toBe(0);
  });
  it('leader skipped, group with no id skipped, newest per person wins', () => {
    expect(checkMembers({ ...mbase, roll: [], actions: [mem('add', 3)] }).count).toBe(0);
    expect(checkMembers({ ...mbase, roll: [], actions: [mem('add', 1, undefined, G2)] }).count).toBe(0);
    expect(checkMembers({ ...mbase, roll: [], actions: [mem('add', 1, '2026-10-20T08:00:00Z'), mem('remove', 1, '2026-10-21T08:00:00Z')] }).count).toBe(0);
  });
});

import { ReconcileLatestRequest, ReconcileLatestResponse } from '../core/link-contract';
describe('reconcile contract', () => {
  it('request is the leaders base shape; response round-trips', () => {
    expect(ReconcileLatestRequest.safeParse({ contractVersion: 1, consoleId: P(1) }).success).toBe(true);
    const res = { contractVersion: 1, run: { ranAt: '2026-10-23T11:15:00.000Z', ok: true,
      checks: { checkins: { count: 2 }, unmatched: { count: 96 }, lifegroups: { count: 0, noId: 0 }, members: { error: true } } },
      entries: [{ tier: 'now', code: 'recon-checkins', line1: '2 app check-ins are missing from Elvanto attendance', count: 2, counted: true, lastSeen: '2026-10-23T11:15:00.000Z' }] };
    expect(ReconcileLatestResponse.parse(res)).toEqual(res);
    expect(ReconcileLatestResponse.safeParse({ ...res, run: null }).success).toBe(true);
  });
});
