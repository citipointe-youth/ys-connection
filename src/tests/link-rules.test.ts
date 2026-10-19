import { describe, it, expect } from 'vitest';
import {
 nameFold, serviceDay,   brisbaneToday, addDays, weekdayOf, brisbaneHHMM, pickList, defaultService, lastMeetingDate, meetsWeekday, dedupeKey,
  LINK_CUTOFF_DAYS, LEASE_LOST_MS, applyOutcome, autoMatch, effectiveCheckState, genderFixes, peopleFlowName, isConsentStep,
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

describe('serviceDay (D3)', () => {
  it('before 03:00 Brisbane the service day is the previous day', () => {
    expect(serviceDay(new Date('2026-10-16T14:30:00Z'))).toBe('2026-10-16'); // Sat 00:30 Brisbane
    expect(serviceDay(new Date('2026-10-16T16:59:00Z'))).toBe('2026-10-16'); // Sat 02:59
    expect(serviceDay(new Date('2026-10-16T17:00:00Z'))).toBe('2026-10-17'); // Sat 03:00
    expect(serviceDay(new Date('2026-10-16T09:00:00Z'))).toBe('2026-10-16'); // Fri 19:00
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
  it('N12: Sunday with one service not at 10:15 -> it', () => {
    expect(defaultService(sun, [svc(2, sun, '2026-10-18T00:30:00Z')])?.serviceTimeId).toBe(U(2));
  });
  it('N12: Sunday with two services -> the one nearest now (Brisbane time of day)', () => {
    const two = [svc(1, sun, '2026-10-18T00:30:00Z'), svc(2, sun, '2026-10-18T07:00:00Z')]; // 10:30 and 17:00
    expect(defaultService(sun, two, new Date('2026-10-18T00:00:00Z'))?.serviceTimeId).toBe(U(1)); // 10:00 now
    expect(defaultService(sun, two, new Date('2026-10-18T06:00:00Z'))?.serviceTimeId).toBe(U(2)); // 16:00 now
  });
  it('a weekday -> none', () => {
    expect(defaultService('2026-10-14', [svc(1, '2026-10-14', '2026-10-14T08:30:00Z')])).toBeNull();
  });
});

describe('meetsWeekday (I2)', () => {
  it('names the weekday 0=Sun..6=Sat, or -1', () => {
    expect(meetsWeekday('Tuesday')).toBe(2);
    expect(meetsWeekday('Tues')).toBe(-1); // T-49: only full names or exact 3-letter forms
    expect(meetsWeekday('Mon 6:30 PM')).toBe(1);
    expect(meetsWeekday('Sunday')).toBe(0);
    expect(meetsWeekday('Monthly')).toBe(-1);
    expect(meetsWeekday('Sunset')).toBe(-1);
    expect(meetsWeekday('')).toBe(-1);
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
  it('T-49 / APP-48: only full day names or exact 3-letter forms count', () => {
    expect(lastMeetingDate('Monthly', '2026-10-16')).toBe('2026-10-16');
    expect(lastMeetingDate('Sunset group, Wed', '2026-10-16')).toBe('2026-10-14');
    expect(lastMeetingDate('Tues 6pm', '2026-10-16')).toBe('2026-10-16');
    expect(lastMeetingDate('Every WEDNESDAY night', '2026-10-16')).toBe('2026-10-14');
    expect(lastMeetingDate('Thursdays', '2026-10-16')).toBe('2026-10-15'); // a full name's plural
    expect(lastMeetingDate('Sat.', '2026-10-16')).toBe('2026-10-10');
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
const stu = (id: string, firstName: string, lastName: string, gender: 'male' | 'female' | 'other', grade: number | null = 9) =>
  ({ id, firstName, lastName, gender, grade });

describe('genderFixes (operator 2026-10-14)', () => {
  it("Elvanto's male/female wins only when folded first + last + grade agree; never blank, never an equal write", () => {
    const st = [stu('s1', 'Olivia', 'Antonucci Cook', 'other'), stu('s2', 'Ben', 'Lee', 'other', 10), stu('s3', 'Amy', 'Ng', 'female')];
    const m = (n: number, sid: string, g: 'male' | 'female' | null, first: string, last: string, over: Partial<LinkRosterRow> = {}) =>
      ros(n, first, last, g, { studentId: sid, match: 'manual', ...over });
    const fix = (r: LinkRosterRow[], c = []) => genderFixes(r, st, c).map((x) => [x.student.id, x.gender]);
    expect(fix([m(1, 's1', 'female', 'Olivia', 'Antonucci-Cook')])).toEqual([['s1', 'female']]); // fold, grade 9 = 9
    expect(fix([m(2, 's2', 'male', 'Ben', 'Lee')])).toEqual([]);                                  // grade 9 vs 10
    expect(fix([m(1, 's1', null, 'Olivia', 'Antonucci-Cook')])).toEqual([]);                      // Elvanto blank
    expect(fix([m(3, 's3', 'female', 'Amy', 'Ng')])).toEqual([]);                                 // already equal
    expect(fix([m(1, 's1', 'female', 'Olivia', 'Antonucci-Cook', { match: 'ignored' })])).toEqual([]);
    // an auto match made in the same push counts
    expect(genderFixes([ros(1, 'Olivia', 'Antonucci Cook', 'female')], st, [{ personId: U(1), studentId: 's1', match: 'auto' }])
      .map((x) => x.gender)).toEqual(['female']);
  });
});

describe('B16 / X8 one name fold', () => {
  it('accents, curly quotes, spaces round a hyphen, double spaces, case, trim', () => {
    expect(nameFold('  Zo\u00eb  O\u2019Brien-  Smith ')).toBe("zoe o'brien-smith");
    expect(nameFold('Ren\u00e9e Mary - Jane')).toBe('renee mary-jane');
    expect(nameFold('Jos\u0065\u0301')).toBe('jose');
    expect(nameFold('Josh')).not.toBe(nameFold('Joshua')); // a short name still does not match a full name
  });
  it('the first-timer dedupe key uses the fold', () => {
    const st = U(4);
    expect(dedupeKey('firstTimerCheckIn', { serviceTimeId: st, firstName: 'Zo\u00eb', lastName: 'O\u2019Brien - Smith' }))
      .toBe(`first:${st}:zoe o'brien-smith`);
  });
  it('autoMatch folds both sides: curly apostrophe, accent, hyphen spaces, double spaces', () => {
    expect(autoMatch([ros(1, 'Zo\u00eb', 'O\u2019Brien', 'female'), ros(2, 'Mary  Jane', 'Lee - Ross', 'female')],
      [stu('s1', 'Zoe', "O'Brien", 'female'), stu('s2', 'Mary Jane', 'Lee-Ross', 'female')]))
      .toEqual([{ personId: U(1), studentId: 's1', match: 'auto' }, { personId: U(2), studentId: 's2', match: 'auto' }]);
  });
  it('two Josh Smiths: grade breaks the tie only when exactly one candidate grade matches', () => {
    const students = [stu('s8', 'Josh', 'Smith', 'male', 8), stu('s11', 'Josh', 'Smith', 'male', 11)];
    expect(autoMatch([ros(1, 'Josh', 'Smith', 'male', { grade: 8 }), ros(2, 'Josh', 'Smith', 'male', { grade: 11 })], students))
      .toEqual([{ personId: U(1), studentId: 's8', match: 'auto' }, { personId: U(2), studentId: 's11', match: 'auto' }]);
    expect(autoMatch([ros(1, 'Josh', 'Smith', 'male', { grade: 8 })], students))
      .toEqual([{ personId: U(1), studentId: 's8', match: 'auto' }]);
    expect(autoMatch([ros(1, 'Josh', 'Smith', 'male', { grade: 9 })], students))
      .toEqual([{ personId: U(1), studentId: null, match: 'ambiguous' }]);
    expect(autoMatch([ros(1, 'Josh', 'Smith', 'male', { grade: null })], students))
      .toEqual([{ personId: U(1), studentId: null, match: 'ambiguous' }]);
    // two roster rows in the same grade: no tie-break for either
    expect(autoMatch([ros(1, 'Josh', 'Smith', 'male', { grade: 8 }), ros(2, 'Josh', 'Smith', 'male', { grade: 8 })], students))
      .toEqual([{ personId: U(1), studentId: null, match: 'ambiguous' }, { personId: U(2), studentId: null, match: 'ambiguous' }]);
    // two students in the same grade: no tie-break
    expect(autoMatch([ros(1, 'Josh', 'Smith', 'male', { grade: 8 })], [...students, stu('s8b', 'Josh', 'Smith', 'male', 8)]))
      .toEqual([{ personId: U(1), studentId: null, match: 'ambiguous' }]);
  });
});

describe('autoMatch (contract 6)', () => {
  it('name key + equal gender, one student -> auto', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'male')], [stu('s1', 'alex', 'SAMPLE', 'male')]))
      .toEqual([{ personId: U(1), studentId: 's1', match: 'auto' }]);
  });
  it('gender differs -> stays none (no change)', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'female')], [stu('s1', 'Alex', 'Sample', 'male')])).toEqual([]);
  });
  it('2026-10-14 Olivia: YS gender other (unknown) still auto-matches a female Elvanto row', () => {
    expect(autoMatch([ros(1, 'Olivia', 'Antonucci-Cook', 'female', { grade: 7 })], [stu('s1', 'Olivia', 'Antonucci-Cook', 'other', 7)]))
      .toEqual([{ personId: U(1), studentId: 's1', match: 'auto' }]);
  });
  it('blank Elvanto gender still auto-matches', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', null)], [stu('s1', 'Alex', 'Sample', 'male')]))
      .toEqual([{ personId: U(1), studentId: 's1', match: 'auto' }]);
  });
  it('hyphen, space, apostrophe and accent folding: Antonucci Cook = Antonucci-Cook, OBrien = O’Brien', () => {
    expect(autoMatch([ros(1, 'Olivia', 'Antonucci Cook', 'female'), ros(2, 'Zoë', 'OBrien', 'female')],
      [stu('s1', 'Olivia', 'Antonucci-Cook', 'female'), stu('s2', 'Zoe', 'O’Brien', 'female')]))
      .toEqual([{ personId: U(1), studentId: 's1', match: 'auto' }, { personId: U(2), studentId: 's2', match: 'auto' }]);
  });
  it('surname alone never auto-matches', () => {
    expect(autoMatch([ros(1, 'Olivia', 'Cook', 'female', { grade: 7 })], [stu('s1', 'Liv', 'Cook', 'female', 7)])).toEqual([]);
  });
  it('a student another roster person holds is never taken', () => {
    expect(autoMatch([ros(1, 'Alex', 'Sample', 'male'), ros(2, 'Al', 'Other', 'male', { studentId: 's1', match: 'manual' })],
      [stu('s1', 'Alex', 'Sample', 'male')])).toEqual([]);
  });
  it('several same-name students with unknown gender: the unique grade match wins', () => {
    expect(autoMatch([ros(1, 'Sam', 'Lee', null, { grade: 8 })], [stu('s8', 'Sam', 'Lee', 'male', 8), stu('s10', 'Sam', 'Lee', 'female', 10)]))
      .toEqual([{ personId: U(1), studentId: 's8', match: 'auto' }]);
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
    expect(effectiveCheckState({ mirrorIn: true, mirrorTakenAt: T0, rows: [] })).toEqual({ in: true });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: null, rows: [] }).in).toBe(false);
  });
  it.each(['pending', 'claimed', 'unclear'] as const)('newest %s row decides', (status) => {
    const r = row({ type: 'checkIn', status });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T2, rows: [r] })).toEqual({ in: true });
  });
  it('sent decides only while resultAt > mirrorTakenAt', () => {
    const r = row({ type: 'checkIn', status: 'sent', resultAt: T1 });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T0, rows: [r] }).in).toBe(true);
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T2, rows: [r] }).in).toBe(false); // the mirror decides
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: null, rows: [r] }).in).toBe(true);
  });
  it('T-21 / X11: a sent row still decides while resultAt + 120 s > takenAt (clock skew)', () => {
    const r = row({ type: 'checkIn', status: 'sent', resultAt: T1 });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: '2026-10-16T09:06:59Z', rows: [r] }).in).toBe(true);
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: '2026-10-16T09:07:00Z', rows: [r] }).in).toBe(false);
  });
  it('cancelled and refused are ignored', () => {
    const cancelled = row({ type: 'checkOut', status: 'cancelled' });
    const pendingIn = row({ id: U(2), type: 'checkIn', status: 'pending' });
    const s = effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T0, rows: [cancelled, pendingIn] });
    expect(s.in).toBe(true);
    const refused = row({ type: 'checkIn', status: 'refused' });
    expect(effectiveCheckState({ mirrorIn: false, mirrorTakenAt: T0, rows: [refused] }).in).toBe(false); // the mirror decides
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

describe('E3: the New People flow by year (no hardcoded 2026)', () => {
  const N = (y: number) => `Brisbane - Youth - New People ${y}`;
  it('picks the highest year <= this Brisbane year, else the highest; other names never match', () => {
    expect(peopleFlowName([N(2026)], '2026-10-19')).toBe(N(2026));
    expect(peopleFlowName([N(2026), N(2027)], '2026-12-15')).toBe(N(2026)); // 2027 made early: 2026 until the year turns
    expect(peopleFlowName([N(2026), N(2027)], '2027-01-01')).toBe(N(2027));
    expect(peopleFlowName([N(2026)], '2027-01-20')).toBe(N(2026)); // January, 2027 not made yet
    expect(peopleFlowName([N(2027)], '2026-12-15')).toBe(N(2027)); // only a future one: the highest
    expect(peopleFlowName(['Brisbane - Youth - Parent Consent', 'Follow up'], '2026-10-19')).toBeNull();
    // prefix like the console: a suffix still matches (never switches the gate off); the exact name wins a same-year tie
    expect(peopleFlowName(['Brisbane - Youth - New People 2026 (Term 4)'], '2026-10-19')).toBe('Brisbane - Youth - New People 2026 (Term 4)');
    expect(peopleFlowName(['Brisbane - Youth - New People 2026 old', N(2026)], '2026-10-19')).toBe(N(2026));
    expect(peopleFlowName(['Brisbane - Youth - New People 20261'], '2026-10-19')).toBeNull();
  });
  it('isConsentStep: step 0 of the picked flow only', () => {
    const r = (flowName: string, stepName: string) => ({ flowName, stepName });
    expect(isConsentStep(r(N(2027), 'Step 0 - wait'), N(2027))).toBe(true);
    expect(isConsentStep(r(N(2027), '0'), N(2027))).toBe(true);
    expect(isConsentStep(r(N(2026), 'Step 0 - wait'), N(2027))).toBe(false); // last year's flow after the changeover
    expect(isConsentStep(r(N(2027), 'Step 1 - text'), N(2027))).toBe(false);
    expect(isConsentStep(r(N(2026), 'Step 0'), null)).toBe(false);
  });
});
