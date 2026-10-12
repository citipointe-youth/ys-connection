import { describe, it, expect } from 'vitest';
import {
  brisbaneToday, addDays, weekdayOf, brisbaneHHMM, pickList, defaultService, lastMeetingDate, dedupeKey,
  LINK_CUTOFF_DAYS, LEASE_LOST_MS, applyOutcome, autoMatch, effectiveCheckState,
} from '../services/link-rules';
import type { LinkServiceRow, OutboxRow, LinkRosterRow, ResultItem } from '../core/link-types';
import { readLinkSyncToken } from '../config/env';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function svc(n: number, ymd: string, startsAt: string): LinkServiceRow {
  return { serviceTimeId: U(n), serviceId: U(100 + n), name: `S${n}`, startsAt, ymd, rooms: [], checkedIn: [] };
}

// ---------------- B1: time, service, dedupe ----------------

describe('link-rules time helpers', () => {
  it('brisbaneToday flips at 14:00Z', () => {
    expect(brisbaneToday(new Date('2026-10-15T13:59:00Z'))).toBe('2026-10-15');
    expect(brisbaneToday(new Date('2026-10-15T14:00:00Z'))).toBe('2026-10-16');
  });
  it('addDays crosses a month and a year end', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-10-16', -7)).toBe('2026-10-09');
  });
  it('weekdayOf (0 = Sunday)', () => {
    expect(weekdayOf('2026-10-16')).toBe(5);
    expect(weekdayOf('2026-10-18')).toBe(0);
  });
  it('brisbaneHHMM', () => {
    expect(brisbaneHHMM('2026-10-16T08:30:00Z')).toBe('18:30');
    expect(brisbaneHHMM('2026-10-17T14:05:00Z')).toBe('00:05');
  });
  it('constants', () => {
    expect(LINK_CUTOFF_DAYS).toBe(3);
    expect(LEASE_LOST_MS).toBe(3_600_000);
  });
});

describe('pickList', () => {
  it('keeps today-7 .. today, newest first, drops future and older', () => {
    const today = '2026-10-16';
    const list = pickList([
      svc(1, '2026-10-09', '2026-10-09T08:30:00Z'),
      svc(2, '2026-10-16', '2026-10-16T08:30:00Z'),
      svc(3, '2026-10-17', '2026-10-17T08:30:00Z'), // future
      svc(4, '2026-10-08', '2026-10-08T08:30:00Z'), // too old
      svc(5, '2026-10-11', '2026-10-11T00:15:00Z'),
    ], today);
    expect(list.map((s) => s.serviceTimeId)).toEqual([U(2), U(5), U(1)]);
  });
  it('same day: later start first', () => {
    const list = pickList([svc(1, '2026-10-18', '2026-10-18T00:15:00Z'), svc(2, '2026-10-18', '2026-10-18T07:00:00Z')], '2026-10-18');
    expect(list.map((s) => s.serviceTimeId)).toEqual([U(2), U(1)]);
  });
});

describe('defaultService', () => {
  const fri = '2026-10-16';
  const sun = '2026-10-18';
  it('Friday with one service -> it', () => {
    expect(defaultService(fri, [svc(1, fri, '2026-10-16T08:30:00Z'), svc(9, '2026-10-09', '2026-10-09T08:30:00Z')])?.serviceTimeId).toBe(U(1));
  });
  it('Friday with two -> none', () => {
    expect(defaultService(fri, [svc(1, fri, '2026-10-16T08:30:00Z'), svc(2, fri, '2026-10-16T09:30:00Z')])).toBeNull();
  });
  it('Sunday with one 10:15 service -> it', () => {
    expect(defaultService(sun, [svc(1, sun, '2026-10-18T00:15:00Z')])?.serviceTimeId).toBe(U(1));
  });
  it('Sunday with a 10:15 and a 17:00 -> the 10:15', () => {
    expect(defaultService(sun, [svc(2, sun, '2026-10-18T07:00:00Z'), svc(1, sun, '2026-10-18T00:15:00Z')])?.serviceTimeId).toBe(U(1));
  });
  it('Sunday with no 10:15 -> none', () => {
    expect(defaultService(sun, [svc(2, sun, '2026-10-18T07:00:00Z')])).toBeNull();
  });
  it('a weekday -> none', () => {
    expect(defaultService('2026-10-14', [svc(1, '2026-10-14', '2026-10-14T08:30:00Z')])).toBeNull();
  });
});

describe('lastMeetingDate', () => {
  it('Tuesday from a Friday -> that week\'s Tuesday', () => {
    expect(lastMeetingDate('Tuesday', '2026-10-16')).toBe('2026-10-13');
    expect(lastMeetingDate('Tue 6:30 PM', '2026-10-16')).toBe('2026-10-13');
  });
  it('same weekday -> today', () => {
    expect(lastMeetingDate('Fri 7:00 PM', '2026-10-16')).toBe('2026-10-16');
  });
  it('Saturday from a Friday -> last week', () => {
    expect(lastMeetingDate('Sat', '2026-10-16')).toBe('2026-10-10');
  });
  it('no weekday -> today', () => {
    expect(lastMeetingDate('', '2026-10-16')).toBe('2026-10-16');
    expect(lastMeetingDate('7:00 PM', '2026-10-16')).toBe('2026-10-16');
  });
});

describe('dedupeKey (contract 5.1)', () => {
  const st = U(1), person = U(2), group = U(3), row = U(4);
  it('all six types', () => {
    expect(dedupeKey('checkIn', { serviceTimeId: st, serviceId: U(5), personId: person })).toBe(`checkIn:${st}:${person}`);
    expect(dedupeKey('checkOut', { serviceTimeId: st, personId: person })).toBe(`checkOut:${st}:${person}`);
    expect(dedupeKey('submitReport', { groupId: group, date: '2026-10-13' })).toBe(`report:${group}:2026-10-13`);
    expect(dedupeKey('editReport', { groupId: group, date: '2026-10-13', reportId: U(6) })).toBe(`report:${group}:2026-10-13`);
    expect(dedupeKey('completeStep', { rowId: row })).toBe(`complete:${row}`);
    expect(dedupeKey('firstTimerCheckIn', { serviceTimeId: st, firstName: 'Alex', lastName: 'Sample' })).toBe(`first:${st}:alex sample`);
  });
  it('first: key lower case, inner spaces folded, trimmed', () => {
    expect(dedupeKey('firstTimerCheckIn', { serviceTimeId: st, firstName: ' ALEX ', lastName: '  Sample  ' })).toBe(`first:${st}:alex sample`);
    expect(dedupeKey('firstTimerCheckIn', { serviceTimeId: st, firstName: 'Mary  Ann', lastName: 'Van  Der Berg' })).toBe(`first:${st}:mary ann van der berg`);
  });
});

// ---------------- B2: state machine, auto-match, effective state ----------------

const CONSOLE = U(900);
const OTHER = U(901);
const NOW = new Date('2026-10-16T09:00:00Z');

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: U(1), type: 'checkIn', payload: {}, note: null, dedupeKey: 'k', serviceDate: '2026-10-16', studentId: null,
    personId: null, createdBy: U(50), leaderId: null, leaderName: 'Test', status: 'claimed', reason: null, detail: null,
    attempts: 1, retryAt: null, leaseOwner: CONSOLE, leaseUntil: '2026-10-16T09:03:00Z', resultAt: null, sentLogKey: null,
    reportId: null, createdAt: '2026-10-16T08:50:00Z', updatedAt: '2026-10-16T08:58:00Z', ...over,
  };
}
const nowIso = NOW.toISOString();

describe('applyOutcome (contract 3.3 / 5.3)', () => {
  it('null row -> unknown-id', () => {
    expect(applyOutcome(null, { id: U(1), outcome: 'already' }, CONSOLE, NOW)).toEqual({ ignored: 'unknown-id' });
  });
  it('sent stores sentLogKey, reportId, personId, resultAt', () => {
    const r = applyOutcome(row({ type: 'submitReport' }), { id: U(1), outcome: 'sent', sentLogKey: 'submitReport:lifegroup:x:20261013', reportId: U(7), personId: U(8) }, CONSOLE, NOW);
    // B2: exact match, so a stray column fails the test.
    expect(r).toEqual({ next: { status: 'sent', reason: null, detail: null, sentLogKey: 'submitReport:lifegroup:x:20261013',
      reportId: U(7), personId: U(8), resultAt: nowIso, updatedAt: nowIso } });
  });
  it('sent without personId keeps the row personId', () => {
    const r = applyOutcome(row({ personId: U(3) }), { id: U(1), outcome: 'sent', sentLogKey: 'k1' }, CONSOLE, NOW);
    expect('next' in r && r.next.personId).toBe(U(3));
  });
  it('already -> sent, reason already', () => {
    const r = applyOutcome(row(), { id: U(1), outcome: 'already' }, CONSOLE, NOW);
    expect(r).toEqual({ next: expect.objectContaining({ status: 'sent', reason: 'already', resultAt: nowIso }) });
  });
  it('refused stores reason and detail', () => {
    const r = applyOutcome(row(), { id: U(1), outcome: 'refused', reason: 'no-room', detail: 'No room.' }, CONSOLE, NOW);
    expect(r).toEqual({ next: expect.objectContaining({ status: 'refused', reason: 'no-room', detail: 'No room.', resultAt: nowIso }) });
  });
  it('unclear stores sentLogKey and detail', () => {
    const r = applyOutcome(row(), { id: U(1), outcome: 'unclear', sentLogKey: 'k2', detail: 'Maybe.' }, CONSOLE, NOW);
    expect(r).toEqual({ next: expect.objectContaining({ status: 'unclear', sentLogKey: 'k2', detail: 'Maybe.' }) });
  });
  it('shadowed stores sentLogKey', () => {
    const r = applyOutcome(row(), { id: U(1), outcome: 'shadowed', sentLogKey: 'k3' }, CONSOLE, NOW);
    expect(r).toEqual({ next: expect.objectContaining({ status: 'shadowed', sentLogKey: 'k3', resultAt: nowIso }) });
  });
  it('retry -> pending, retryAt = now + retrySeconds, lease cleared', () => {
    const r = applyOutcome(row(), { id: U(1), outcome: 'retry', retrySeconds: 300, reason: 'awaiting-approval' }, CONSOLE, NOW);
    expect(r).toEqual({ next: expect.objectContaining({ status: 'pending', reason: 'awaiting-approval',
      retryAt: '2026-10-16T09:05:00.000Z', leaseOwner: null, leaseUntil: null }) });
  });
  it('B2 / X5: resolved from unclear by any console; reason and detail cleared, no ids', () => {
    const unclear = row({ status: 'unclear', leaseOwner: CONSOLE, reason: 'lease-lost', detail: 'Maybe.', sentLogKey: 'k9' });
    const landed = applyOutcome(unclear, { id: U(1), outcome: 'resolved', landed: true }, OTHER, NOW);
    expect(landed).toEqual({ next: { status: 'sent', reason: null, detail: null, resultAt: nowIso, updatedAt: nowIso } });
    const notLanded = applyOutcome(unclear, { id: U(1), outcome: 'resolved', landed: false }, OTHER, NOW);
    expect(notLanded).toEqual({ next: { status: 'refused', reason: 'not-landed', detail: null, resultAt: nowIso, updatedAt: nowIso } });
  });
  it('claimed row counts for the lease owner even when the lease expired', () => {
    const r = applyOutcome(row({ leaseUntil: '2026-10-16T08:00:00Z' }), { id: U(1), outcome: 'already' }, CONSOLE, NOW);
    expect('next' in r).toBe(true);
  });
  it('another console on a claimed row -> not-leased', () => {
    expect(applyOutcome(row(), { id: U(1), outcome: 'already' }, OTHER, NOW)).toEqual({ ignored: 'not-leased' });
  });
  it('a pending row -> not-leased', () => {
    expect(applyOutcome(row({ status: 'pending', leaseOwner: null }), { id: U(1), outcome: 'already' }, CONSOLE, NOW)).toEqual({ ignored: 'not-leased' });
  });
  it('same outcome on a final row -> already-final', () => {
    expect(applyOutcome(row({ status: 'sent' }), { id: U(1), outcome: 'sent', sentLogKey: 'k' }, CONSOLE, NOW)).toEqual({ ignored: 'already-final' });
    expect(applyOutcome(row({ status: 'refused', reason: 'no-room' }), { id: U(1), outcome: 'refused', reason: 'no-room' }, CONSOLE, NOW)).toEqual({ ignored: 'already-final' });
    expect(applyOutcome(row({ status: 'shadowed' }), { id: U(1), outcome: 'shadowed', sentLogKey: 'k' }, CONSOLE, NOW)).toEqual({ ignored: 'already-final' });
    expect(applyOutcome(row({ status: 'sent' }), { id: U(1), outcome: 'resolved', landed: true }, CONSOLE, NOW)).toEqual({ ignored: 'already-final' });
    expect(applyOutcome(row({ status: 'unclear' }), { id: U(1), outcome: 'unclear', sentLogKey: 'k' }, CONSOLE, NOW)).toEqual({ ignored: 'already-final' });
  });
  it('a different outcome on a final row -> bad-transition', () => {
    expect(applyOutcome(row({ status: 'sent' }), { id: U(1), outcome: 'refused', reason: 'no-room' }, CONSOLE, NOW)).toEqual({ ignored: 'bad-transition' });
    expect(applyOutcome(row({ status: 'cancelled' }), { id: U(1), outcome: 'sent', sentLogKey: 'k' }, CONSOLE, NOW)).toEqual({ ignored: 'bad-transition' });
    expect(applyOutcome(row({ status: 'refused', reason: 'too-old' }), { id: U(1), outcome: 'resolved', landed: true }, CONSOLE, NOW)).toEqual({ ignored: 'bad-transition' });
    expect(applyOutcome(row({ status: 'unclear' }), { id: U(1), outcome: 'sent', sentLogKey: 'k' }, CONSOLE, NOW)).toEqual({ ignored: 'bad-transition' });
  });
  it('resolved on a claimed or pending row -> bad-transition', () => {
    const item: ResultItem = { id: U(1), outcome: 'resolved', landed: true };
    expect(applyOutcome(row(), item, CONSOLE, NOW)).toEqual({ ignored: 'bad-transition' });
    expect(applyOutcome(row({ status: 'pending', leaseOwner: null }), item, CONSOLE, NOW)).toEqual({ ignored: 'bad-transition' });
  });
});

function ros(n: number, first: string, last: string, gender: 'male' | 'female' | null, over: Partial<LinkRosterRow> = {}): LinkRosterRow {
  return { personId: U(n), firstName: first, lastName: last, gender, grade: 9, kind: 'student', active: true, studentId: null,
    match: 'none', updatedAt: '2026-10-01T00:00:00Z', ...over };
}
const stu = (id: string, firstName: string, lastName: string, gender: 'male' | 'female' | 'other') => ({ id, firstName, lastName, gender });

describe('autoMatch (contract 6)', () => {
  it('name key + equal gender, one student -> auto', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'male')], [stu('s1', 'alex', 'SAMPLE', 'male')]))
      .toEqual([{ personId: U(1), studentId: 's1', match: 'auto' }]);
  });
  it('gender differs -> stays none (no change)', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'female')], [stu('s1', 'Alex', 'Sample', 'male')])).toEqual([]);
  });
  it('two students -> ambiguous', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'male')], [stu('s1', 'Alex', 'Sample', 'male'), stu('s2', 'Alex', 'Sample', 'male')]))
      .toEqual([{ personId: U(1), studentId: null, match: 'ambiguous' }]);
  });
  it('two roster rows with the same key -> ambiguous (both)', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'male'), ros(2, 'alex', 'sample', 'male')], [stu('s1', 'Alex', 'Sample', 'male')]))
      .toEqual([{ personId: U(1), studentId: null, match: 'ambiguous' }, { personId: U(2), studentId: null, match: 'ambiguous' }]);
  });
  it('none stays none', () => {
    expect(autoMatch([ros(1, 'Nobody', 'Here', 'male')], [stu('s1', 'Alex', 'Sample', 'male')])).toEqual([]);
  });
  it('dead studentId reset to none', () => {
    expect(autoMatch([ros(1, 'Gone', 'Person', 'male', { studentId: 'dead', match: 'manual' })], []))
      .toEqual([{ personId: U(1), studentId: null, match: 'none' }]);
  });
  it('dead studentId reset then re-matched in the same pass', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'male', { studentId: 'dead', match: 'auto' })], [stu('new', 'Alex', 'Sample', 'male')]))
      .toEqual([{ personId: U(1), studentId: 'new', match: 'auto' }]);
  });
  it('manual, auto and ignored rows never change', () => {
    const roster = [
      ros(1, 'Alex', 'Sample', 'male', { studentId: 's9', match: 'manual' }),
      ros(2, 'Bo', 'Sample', 'male', { studentId: 's8', match: 'auto' }),
      ros(3, 'Cy', 'Sample', 'male', { match: 'ignored' }),
    ];
    const students = [stu('s9', 'X', 'Y', 'male'), stu('s8', 'Z', 'W', 'male'), stu('s1', 'Alex', 'Sample', 'male'),
      stu('s2', 'Bo', 'Sample', 'male'), stu('s3', 'Cy', 'Sample', 'male')];
    expect(autoMatch(roster, students)).toEqual([]);
  });
  it('A6 / APP-11 A: a leader or other row never auto-matches; a leader auto row is released', () => {
    expect(autoMatch([ros(1, 'Sam', 'Taylor', 'male', { kind: 'leader' }), ros(2, 'Pat', 'Parent', 'female', { kind: 'other' })],
      [stu('s1', 'Sam', 'Taylor', 'male'), stu('s2', 'Pat', 'Parent', 'female')])).toEqual([]);
    expect(autoMatch([ros(1, 'Sam', 'Taylor', 'male', { kind: 'leader', studentId: 's1', match: 'auto' })], [stu('s1', 'Sam', 'Taylor', 'male')]))
      .toEqual([{ personId: U(1), studentId: null, match: 'none' }]);
  });
  it('A6 / APP-11 B: an inactive auto row is released and the new profile takes the student', () => {
    const roster = [ros(1, 'Alex', 'Sample', 'male', { active: false, studentId: 's1', match: 'auto' }), ros(2, 'Alex', 'Sample', 'male')];
    expect(autoMatch(roster, [stu('s1', 'Alex', 'Sample', 'male')])).toEqual([
      { personId: U(1), studentId: null, match: 'none' }, { personId: U(2), studentId: 's1', match: 'auto' }]);
  });
  it('A6: an inactive row does not count towards the same-name check, and never matches', () => {
    const roster = [ros(1, 'Alex', 'Sample', 'male', { active: false }), ros(2, 'Alex', 'Sample', 'male')];
    expect(autoMatch(roster, [stu('s1', 'Alex', 'Sample', 'male')])).toEqual([{ personId: U(2), studentId: 's1', match: 'auto' }]);
  });
  it('a student already linked to another roster row is not offered again', () => {
    const roster = [ros(1, 'Other', 'Name', 'male', { studentId: 's1', match: 'manual' }), ros(2, 'Alex', 'Sample', 'male')];
    expect(autoMatch(roster, [stu('s1', 'Alex', 'Sample', 'male')])).toEqual([]);
  });
});

describe('effectiveCheckState (spec 5.2)', () => {
  const T0 = '2026-10-16T09:00:00Z';
  const T1 = '2026-10-16T09:05:00Z';
  const T2 = '2026-10-16T09:10:00Z';
  it('no rows -> mirror', () => {
    expect(effectiveCheckState({ mirrorIn: true, mirrorTakenAt: T0, rows: [] })).toEqual({ in: true, practice: false, row: null, source: 'mirror' });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: null, rows: [] }).in).toBe(false);
  });
  it.each(['pending', 'claimed', 'unclear'] as const)('newest %s row decides', (status) => {
    const r = row({ type: 'checkIn', status });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T2, rows: [r] })).toEqual({ in: true, practice: false, row: r, source: 'row' });
  });
  it('shadowed decides with practice', () => {
    const r = row({ type: 'checkIn', status: 'shadowed', resultAt: T0 });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T2, rows: [r] })).toEqual({ in: true, practice: true, row: r, source: 'row' });
  });
  it('sent decides only while resultAt > mirrorTakenAt', () => {
    const r = row({ type: 'checkIn', status: 'sent', resultAt: T1 });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T0, rows: [r] }).source).toBe('row');
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T0, rows: [r] }).in).toBe(true);
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T2, rows: [r] }).source).toBe('mirror');
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: null, rows: [r] }).source).toBe('row');
  });
  it('cancelled and refused are ignored', () => {
    const cancelled = row({ type: 'checkOut', status: 'cancelled' });
    const pendingIn = row({ id: U(2), type: 'checkIn', status: 'pending' });
    const s = effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T0, rows: [cancelled, pendingIn] });
    expect(s.in).toBe(true);
    expect(s.row).toBe(pendingIn);
    const refused = row({ type: 'checkIn', status: 'refused' });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T0, rows: [refused] }).source).toBe('mirror');
  });
  it('sent check-in, then a kiosk check-out (newer mirror says out) -> out', () => {
    const r = row({ type: 'checkIn', status: 'sent', resultAt: T1 });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T2, rows: [r] }).in).toBe(false);
  });
  it('sent check-out, then a kiosk check-in (newer mirror says in) -> in', () => {
    const out = row({ type: 'checkOut', status: 'sent', resultAt: T1 });
    expect(effectiveCheckState({ mirrorIn: true, mirrorTakenAt: T2, rows: [out] }).in).toBe(true);
    expect(effectiveCheckState({ mirrorIn: true, mirrorTakenAt: T0, rows: [out] }).in).toBe(false);
  });
});

describe('readLinkSyncToken', () => {
  it('unset, blank or under 32 characters -> undefined', () => {
    expect(readLinkSyncToken({})).toBeUndefined();
    expect(readLinkSyncToken({ LINK_SYNC_TOKEN: '   ' })).toBeUndefined();
    expect(readLinkSyncToken({ LINK_SYNC_TOKEN: 'a'.repeat(31) })).toBeUndefined();
  });
  it('32+ characters -> trimmed token', () => {
    expect(readLinkSyncToken({ LINK_SYNC_TOKEN: ` ${'b'.repeat(32)} ` })).toBe('b'.repeat(32));
  });
});
