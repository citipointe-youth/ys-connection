import { describe, it, expect } from 'vitest';
import { buildServiceModel, buildGroupModel, buildLifegroupStats, parseGroupMeta } from '../services/attendance-build';
import { computeAllTerms } from '../services/year-terms';

describe('buildServiceModel (typed rows, spec 2026-10-22 §5.1)', () => {
  it('one session per ISO date (id = the date), validity from the floor, no gender needed, duplicates counted once', () => {
    const m = buildServiceModel([
      { id: 'p1', dates: ['2026-02-06', '2026-02-13'] },
      { id: 'p2', dates: ['2026-02-06'] },
      { id: 'p2', dates: ['2026-02-06'] }, // the same person twice in one export
    ], 2);
    expect(m.sessions).toEqual([
      { id: '2026-02-06', sessionDate: '2026-02-06', isValid: true },
      { id: '2026-02-13', sessionDate: '2026-02-13', isValid: false },
    ]);
    expect(m.attendance).toEqual([
      { id: 'p1', sessionId: '2026-02-06' }, { id: 'p1', sessionId: '2026-02-13' }, { id: 'p2', sessionId: '2026-02-06' },
    ]);
  });
});

describe('buildGroupModel', () => {
  const group = {
    name: 'Grade 9 Girls Lifegroup', meetings: ['2026-02-09', '2026-02-16'],
    members: [
      { id: 'p1', first_name: 'Jamie', last_name: 'Test', attendance: [true, false] },
      { id: 'p2', first_name: 'Mia', last_name: 'Sample', attendance: [false, false] }, // never came: not part of it
    ],
  };
  it('keeps members with at least one attended week; weeks ran = weeks with any mark', () => {
    const m = buildGroupModel([group]);
    expect(m.weeks.map((w) => w.weekStart)).toEqual(['2026-02-07', '2026-02-14']);
    expect(m.attendance.filter((a) => a.id === 'p1').map((a) => a.attended)).toEqual([true, false]);
    expect(m.attendance.some((a) => a.id === 'p2')).toBe(false);
  });
  it('buckets weeks by serviceDayOfWeek (Wednesday service: weeks start Thursday)', () => {
    expect(buildGroupModel([group], 3).weeks.map((w) => w.weekStart)).toEqual(['2026-02-05', '2026-02-12']);
  });
});

describe('buildLifegroupStats', () => {
  it('per-term per-lifegroup stats keyed by member id; weeks follow serviceDayOfWeek', () => {
    const terms = computeAllTerms(['2026-02-07', '2026-02-14', '2026-04-18', '2026-04-25'], 14);
    const stats = buildLifegroupStats([{
      name: 'Grade 9 Girls Lifegroup', meetings: ['2026-02-09', '2026-04-20'],
      members: [
        { id: 'p1', first_name: 'Jamie', last_name: 'Test', attendance: [true, true] },
        { id: 'p2', first_name: 'Mia', last_name: 'Sample', attendance: [true, false] },
      ],
    }], terms);
    expect(stats['2026-T1']![0]).toMatchObject({ name: 'Grade 9 Girls Lifegroup', grade: 9, quad: 'g79', uniqueAttenders: 2, weeksRan: 1, totalVisits: 2 });
    expect(stats['2026-T2']![0]).toMatchObject({ uniqueAttenders: 1, weeksRan: 1, totalVisits: 1 });
    // Wednesday weeks: 2026-02-09 -> week of 2026-02-05, outside a term that starts 2026-02-07
    expect(buildLifegroupStats([{ name: 'Grade 9 Girls Lifegroup', meetings: ['2026-02-09'],
      members: [{ id: 'p1', first_name: 'Jamie', last_name: 'Test', attendance: [true] }] }], terms, 3)['2026-T1']).toEqual([]);
  });
});

describe('parseGroupMeta', () => {
  it('reads grade and gender from the group name', () => {
    expect(parseGroupMeta('Grade 9 Girls Lifegroup')).toEqual({ grade: 9, gender: 'female' });
    expect(parseGroupMeta('Senior Lifegroup')).toEqual({ grade: null, gender: null });
  });
});
