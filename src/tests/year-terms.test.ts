import { describe, it, expect } from 'vitest';
import { computeAllTerms } from '../services/year-terms';

describe('computeAllTerms', () => {
  it('returns empty for no dates', () => {
    expect(computeAllTerms([], 14)).toEqual([]);
  });

  it('groups one continuous run as a single term', () => {
    const t = computeAllTerms(['2026-02-06', '2026-02-13', '2026-02-20'], 14);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ key: '2026-T1', label: 'Term 1 2026', year: 2026, ordinal: 1, startDate: '2026-02-06', endDate: '2026-02-20' });
  });

  it('splits on a gap greater than termGapDays and increments ordinal within the year', () => {
    // Two runs separated by ~5 weeks (a holiday break)
    const t = computeAllTerms(['2026-02-06', '2026-02-13', '2026-04-24', '2026-05-01'], 14);
    expect(t).toHaveLength(2);
    expect(t[0]!.key).toBe('2026-T1');
    expect(t[1]!.key).toBe('2026-T2');
    expect(t[1]!.startDate).toBe('2026-04-24');
  });

  it('resets ordinal per calendar year across a year boundary', () => {
    const t = computeAllTerms(['2025-10-31', '2025-11-07', '2026-02-06', '2026-02-13'], 14);
    expect(t.map((x) => x.key)).toEqual(['2025-T1', '2026-T1']);
  });
});

describe('computeAllTerms: short runs and the build year (spec 2026-10-22 §5.3.3)', () => {
  it('a run of fewer than minRun sessions joins the neighbour with the smaller gap (here the next one)', () => {
    const t = computeAllTerms(['2026-02-07', '2026-02-14', '2026-02-21', '2026-03-28', '2026-04-25', '2026-05-02', '2026-05-09'], 14, { minRun: 3 });
    expect(t.map((x) => [x.key, x.startDate, x.endDate])).toEqual([
      ['2026-T1', '2026-02-07', '2026-02-21'], ['2026-T2', '2026-03-28', '2026-05-09']]);
  });
  it('joins the previous run when that gap is smaller', () => {
    const t = computeAllTerms(['2026-02-07', '2026-02-14', '2026-02-21', '2026-03-14', '2026-05-02', '2026-05-09', '2026-05-16'], 14, { minRun: 3 });
    expect(t.map((x) => x.endDate)).toEqual(['2026-03-14', '2026-05-16']);
  });
  it('a lone short run is kept (nothing to join)', () => {
    expect(computeAllTerms(['2026-02-07'], 14, { minRun: 3 })).toHaveLength(1);
  });
  it('year: every run is numbered in the build year, even one whose first week starts in late December', () => {
    const t = computeAllTerms(['2025-12-27', '2026-01-03', '2026-01-10'], 14, { year: 2026 });
    expect(t[0]).toMatchObject({ key: '2026-T1', label: 'Term 1 2026', year: 2026, ordinal: 1 });
  });
});
