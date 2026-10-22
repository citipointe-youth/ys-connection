import { describe, it, expect } from 'vitest';
import { auditConfigOf, buildYear, type AuditBuildConfig, type AuditRosterPerson } from '../services/audit-build';
import { leaderTagRe } from '../services/audit-parse';
import { addDays } from '../services/link-rules';
import { QUADS } from '../core/types/enums';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { AppSettings } from '../core/entities/settings';
import type { AuditSource, StoredAuditSource } from '../core/entities/connection-audit';

const CFG: AuditBuildConfig = { timeZone: 'Australia/Brisbane', dateOrder: 'DMY', leaderTag: leaderTagRe('leader'),
  gradeRange: { min: 7, max: 12 }, serviceDayOfWeek: 5, termGapDays: 14, serviceMinAttendance: 1 };
const AT = '2026-10-16T11:03:20.000Z';
const NOW = new Date('2026-10-17T00:00:00.000Z'); // Sat 17 Oct 10:00 Brisbane
const stored = (source: AuditSource, headers: string[], rows: string[][], over: Partial<StoredAuditSource> = {}): StoredAuditSource =>
  ({ year: 2026, source, headers, rows, rowCount: rows.length, takenAt: AT, exportedAt: AT, fedAt: AT, fedBy: 'console',
    lastFailedAt: null, lastFailReason: null, ...over });
type P = { f: string; l: string; p?: string; g?: string; gr?: string; m?: string; pp?: string; at: string[] };
const PH = ['First Name', 'Last Name', 'Preferred Name', 'Gender', 'School Grade', 'Mobile', 'Youth Parent Phone'];
/** A service-shaped export (service or team): ISO session headers (rule 1), 'Y' where the person came. */
const attendance = (source: 'service' | 'team', dates: string[], people: P[], over: Partial<StoredAuditSource> = {}) =>
  stored(source, [...PH, ...dates], people.map((x) => [x.f, x.l, x.p ?? '', x.g ?? '', x.gr ?? '', x.m ?? '', x.pp ?? '',
    ...dates.map((d) => (x.at.includes(d) ? 'Y' : ''))]), over);
const svcOf = (dates: string[], people: P[], over: Partial<StoredAuditSource> = {}) => attendance('service', dates, people, over);
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** A group export: '' header, D/M/YYYY meeting headers, a header row per group, then "Last, First" member rows. */
const groupOf = (dates: string[], groups: { name: string; members: { name: string; at: string[]; absent?: string[] }[] }[]) =>
  stored('group', ['', ...dates.map(dmy)], groups.flatMap((g) => [[g.name, ...dates.map(() => '')],
    ...g.members.map((m) => [m.name, ...dates.map((d) => (m.at.includes(d) ? 'Y' : m.absent?.includes(d) ? 'N' : '-'))])]));
const formOf = (source: 'connect' | 'decision', rows: { f: string; l: string; date: string; gr?: string; g?: string }[]) =>
  stored(source, ['First Name', 'Last Name', 'Date Submitted', 'School Grade', 'Gender'], rows.map((r) => [r.f, r.l, dmy(r.date), r.gr ?? '', r.g ?? '']));
const ros = (personId: string, firstName: string, lastName: string, over: Partial<AuditRosterPerson> = {}): AuditRosterPerson =>
  ({ personId, firstName, lastName, grade: null, gender: null, active: true, ...over });
const fridays = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, 7 * i));
const byFirst = (s: ReturnType<typeof buildYear>, first: string) => s.students.find((x) => x.firstName === first)!;
const P1 = '9e000000-0000-4000-8000-000000000001', P2 = '9e000000-0000-4000-8000-000000000002';

describe('auditConfigOf: the real settings fields', () => {
  it('reads structure, import, termGapDays and serviceMinAttendance', () => {
    const s = { termGapDays: 21, serviceMinAttendance: 5, ministryConfig: MINISTRY_CONFIG_DEFAULTS } as unknown as AppSettings;
    const c = auditConfigOf(s);
    expect(c).toMatchObject({ timeZone: 'Australia/Brisbane', dateOrder: 'DMY', gradeRange: { min: 7, max: 12 }, serviceDayOfWeek: 5, termGapDays: 21, serviceMinAttendance: 5 });
    expect(c.leaderTag!.test('Sample, Mia (Leader)')).toBe(true);
  });
});

describe('buildYear: clip, sessions, terms, inProgress (spec §5.3.1-4)', () => {
  it('Term 1 + the prior T4 in one 12-month export: 2025 dates clipped, the 2026 run is 2026-T1', () => {
    const dates = ['2025-10-31', '2025-11-07', '2025-11-14', '2026-01-30', '2026-02-06', '2026-02-13'];
    const s = buildYear(2026, [svcOf(dates, [{ f: 'Alex', l: 'Sample', g: 'Male', at: dates }])], [], CFG, new Date('2026-02-14T00:00:00Z'));
    expect(s.terms.map((t) => t.key)).toEqual(['2026-T1']);
    expect(s.terms[0]!.label).toBe('Term 1 2026');
    expect(s.perTerm['2026-T1']!.svcTotal).toBe(3);
    expect(s.dataStartDate).toBe('2026-01-30');
    expect(s.dataEndDate).toBe('2026-02-13');
  });
  it('a single-session holiday run is merged into the neighbouring term with the smaller gap', () => {
    const dates = [...fridays('2026-02-06', 4), '2026-04-03', ...fridays('2026-05-01', 3)];
    const s = buildYear(2026, [svcOf(dates, [{ f: 'Alex', l: 'Sample', g: 'Male', at: dates }])], [], CFG, NOW);
    expect(s.terms.map((t) => [t.key, t.startDate])).toEqual([['2026-T1', '2026-01-31'], ['2026-T2', '2026-03-28']]);
    expect(s.perTerm['2026-T2']!.svcTotal).toBe(4);
  });
  it('a session below serviceMinAttendance is not a session', () => {
    const d = ['2026-10-09', '2026-10-16'];
    const s = buildYear(2026, [svcOf(d, [{ f: 'Alex', l: 'Sample', at: d }, { f: 'Jamie', l: 'Test', at: ['2026-10-16'] }])], [], { ...CFG, serviceMinAttendance: 2 }, NOW);
    expect(s.dataStartDate).toBe('2026-10-16');
  });
  it('inProgress: only the latest term, only within termGapDays (site date) of the last session', () => {
    const d = [...fridays('2026-02-06', 4), ...fridays('2026-07-24', 12)]; // T2 ends Fri 9 Oct
    const src = [svcOf(d, [{ f: 'Alex', l: 'Sample', at: d }])];
    const at = (iso: string) => buildYear(2026, src, [], CFG, new Date(iso)).perTerm;
    expect(at('2026-10-17T00:00:00Z')['2026-T2']!.inProgress).toBe(true);
    expect(at('2026-10-17T00:00:00Z')['2026-T1']!.inProgress).toBe(false);
    expect(at('2026-10-23T13:59:00Z')['2026-T2']!.inProgress).toBe(true);  // 23 Oct 23:59 Brisbane = 9 Oct + 14
    expect(at('2026-10-23T14:00:00Z')['2026-T2']!.inProgress).toBe(false); // 24 Oct in Brisbane
  });
  it('inProgress is false for every term of a past year', () => {
    const d = fridays('2025-11-28', 4); // ends Fri 19 Dec 2025
    const s = buildYear(2025, [svcOf(d, [{ f: 'Alex', l: 'Sample', at: d }], { year: 2025, exportedAt: '2025-12-20T00:00:00.000Z' })], [], CFG, new Date('2026-01-01T00:00:00Z'));
    expect(Object.values(s.perTerm).map((t) => t.inProgress)).toEqual([false]);
  });
  it('a source of another year, or one never stored good, contributes nothing', () => {
    const d = ['2026-10-16'];
    const s = buildYear(2026, [svcOf(d, [{ f: 'Alex', l: 'Sample', at: d }]), svcOf(d, [{ f: 'Jamie', l: 'Test', at: d }], { year: 2025 }),
      attendance('team', d, [{ f: 'Sam', l: 'Example', at: d }], { fedAt: null, fedBy: null })], [], CFG, NOW);
    expect(s.students.map((x) => x.firstName)).toEqual(['Alex']);
  });
});

describe('buildYear: identity (spec §5.3.5) and duplicates (§5.3.6)', () => {
  const d = ['2026-10-16'];
  it('matches the roster by first|last (X8 fold), else preferred|last; display name = preferred || first', () => {
    const s = buildYear(2026, [svcOf(d, [{ f: 'Joanna', l: 'Sample', p: 'Jo', at: d }, { f: 'Alex', l: 'sample-', at: d }])],
      [ros(P1, 'Jo', 'Sample'), ros(P2, 'ALEX', 'Sample')], CFG, NOW);
    expect(byFirst(s, 'Jo')).toMatchObject({ id: P1, personId: P1, lastName: 'Sample' });
    expect(byFirst(s, 'Alex')).toMatchObject({ id: P2, personId: P2 });
    expect(s.quality.unmatched).toEqual([]);
  });
  it("apostrophes, accents and hyphens fold the same across sources and the roster (X8 matchFold)", () => {
    const s = buildYear(2026, [svcOf(d, [{ f: 'Zoë', l: 'O’Brien-Sample', at: d }]),
      groupOf(['2026-10-12'], [{ name: 'Grade 9 Girls Lifegroup', members: [{ name: "O'Brien Sample, Zoe", at: ['2026-10-12'] }] }])],
      [ros(P1, 'Zoe', 'OBrien Sample')], CFG, NOW);
    expect(s.students).toHaveLength(1);
    expect(s.students[0]).toMatchObject({ id: P1, personId: P1 });
    expect(s.quality.unmatched).toEqual([]);
  });
  it('grade/gender from the source row, the roster as fallback; inactive roster rows never match', () => {
    const s = buildYear(2026, [svcOf(d, [{ f: 'Alex', l: 'Sample', gr: '9', at: d }, { f: 'Jamie', l: 'Test', at: d }])],
      [ros(P1, 'Alex', 'Sample', { grade: 10, gender: 'male' }), ros(P2, 'Jamie', 'Test', { active: false })], CFG, NOW);
    expect(byFirst(s, 'Alex')).toMatchObject({ grade: 9, gender: 'male', quad: 'b79' });
    expect(byFirst(s, 'Jamie')).toMatchObject({ id: 'n:jamie|test', personId: null });
  });
  it('namesakes (2 roster hits) are not merged: unmatched, ambiguous, no personId invented', () => {
    const s = buildYear(2026, [svcOf(d, [{ f: 'Alex', l: 'Sample', at: d }])], [ros(P1, 'Alex', 'Sample'), ros(P2, 'Alex', 'Sample')], CFG, NOW);
    expect(s.students).toHaveLength(1);
    expect(s.students[0]).toMatchObject({ id: 'n:alex|sample', personId: null });
    expect(s.quality.unmatched).toEqual([{ id: 'n:alex|sample', name: 'Alex Sample', sources: ['service'], grade: null, ambiguous: true }]);
  });
  it('the same n: key in two sources is one person (group "Last, First" uses the same rule)', () => {
    const s = buildYear(2026, [svcOf(d, [{ f: 'Casey', l: 'Other', at: d }]), groupOf(['2026-10-12'], [{ name: 'Grade 9 Boys Lifegroup', members: [{ name: 'Other, Casey', at: ['2026-10-12'] }] }])], [], CFG, NOW);
    expect(s.students).toHaveLength(1);
    expect(s.quality.unmatched[0]).toMatchObject({ id: 'n:casey|other', sources: ['service', 'group'], ambiguous: false });
  });
  it('short-name duplicate: same surname, one first name a 3+ letter prefix of the other, grades equal or one null; flagged, never merged', () => {
    const s = buildYear(2026, [svcOf(d, [{ f: 'Sam', l: 'Example', gr: '9', at: d }]), groupOf(['2026-10-12'], [{ name: 'Grade 9 Girls Lifegroup', members: [{ name: 'Example, Samuel', at: ['2026-10-12'] }] }])], [], CFG, NOW);
    expect(s.students).toHaveLength(2);
    expect(s.quality.duplicates).toEqual([{ a: 'n:sam|example', b: 'n:samuel|example', why: 'short-name' }]);
    const t = buildYear(2026, [svcOf(d, [{ f: 'Sam', l: 'Example', gr: '9', at: d }, { f: 'Samuel', l: 'Example', gr: '10', at: d }, { f: 'Jo', l: 'Sample', at: d }, { f: 'Jordan', l: 'Sample', at: d }])], [], CFG, NOW);
    expect(t.quality.duplicates).toEqual([]); // grades differ; "jo" is under 3 letters
  });
  it('matched-and-unmatched duplicate: an unmatched n: key equal to a key of a matched person', () => {
    const s = buildYear(2026, [svcOf(d, [{ f: 'Joanna', l: 'Sample', p: 'Jo', at: d }]), groupOf(['2026-10-12'], [{ name: 'Grade 9 Girls Lifegroup', members: [{ name: 'Sample, Jo', at: ['2026-10-12'] }] }])],
      [ros(P1, 'Joanna', 'Sample')], CFG, NOW);
    expect(s.quality.duplicates).toEqual([{ a: P1, b: 'n:jo|sample', why: 'matched-and-unmatched' }]);
  });
});
