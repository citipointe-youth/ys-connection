import { describe, it, expect } from 'vitest';
import { computeTerms, classifyDate, inRange } from '../services/terms';

describe('computeTerms', () => {
  it('returns null/null for no dates', () => {
    expect(computeTerms([], 14)).toEqual({ current: null, previous: null });
  });

  it('treats a single run with no big gaps as one (current) term', () => {
    const dates = ['2026-02-06', '2026-02-13', '2026-02-20', '2026-02-27'];
    const t = computeTerms(dates, 14);
    expect(t.current).toEqual({ startDate: '2026-02-06', endDate: '2026-02-27' });
    expect(t.previous).toBeNull();
  });

  it('splits current and previous term across a holiday gap', () => {
    // Term 1: Feb; ~5 week gap; Term 2: Apr
    const dates = [
      '2026-02-06', '2026-02-13', '2026-02-20', '2026-02-27', // term 1
      '2026-04-17', '2026-04-24', '2026-05-01',               // term 2 (current)
    ];
    const t = computeTerms(dates, 14);
    expect(t.current).toEqual({ startDate: '2026-04-17', endDate: '2026-05-01' });
    expect(t.previous).toEqual({ startDate: '2026-02-06', endDate: '2026-02-27' });
  });

  it('only keeps the last two terms when there are three', () => {
    const dates = [
      '2025-10-10', '2025-10-17',                 // term 0 (dropped)
      '2026-02-06', '2026-02-13', '2026-02-20',   // term 1 (previous)
      '2026-05-01', '2026-05-08',                 // term 2 (current)
    ];
    const t = computeTerms(dates, 14);
    expect(t.current).toEqual({ startDate: '2026-05-01', endDate: '2026-05-08' });
    expect(t.previous).toEqual({ startDate: '2026-02-06', endDate: '2026-02-20' });
  });

  it('is resilient across the calendar-year boundary (prev-year T4 + this-year T1)', () => {
    const dates = [
      '2025-11-07', '2025-11-14', '2025-11-21',   // previous year, Term 4 (previous)
      '2026-01-30', '2026-02-06', '2026-02-13',   // this year, Term 1 (current)
    ];
    const t = computeTerms(dates, 14);
    expect(t.current).toEqual({ startDate: '2026-01-30', endDate: '2026-02-13' });
    expect(t.previous).toEqual({ startDate: '2025-11-07', endDate: '2025-11-21' });
  });

  it('does not split on a gap exactly equal to termGapDays', () => {
    // 14 days apart, termGapDays=14 → not greater than, so same term
    const dates = ['2026-02-06', '2026-02-20'];
    const t = computeTerms(dates, 14);
    expect(t.previous).toBeNull();
    expect(t.current).toEqual({ startDate: '2026-02-06', endDate: '2026-02-20' });
  });

  it('dedupes and sorts unsorted input', () => {
    const dates = ['2026-02-20', '2026-02-06', '2026-02-20', '2026-02-13'];
    const t = computeTerms(dates, 14);
    expect(t.current).toEqual({ startDate: '2026-02-06', endDate: '2026-02-20' });
  });
});

describe('inRange / classifyDate', () => {
  const terms = {
    current: { startDate: '2026-04-17', endDate: '2026-05-01' },
    previous: { startDate: '2026-02-06', endDate: '2026-02-27' },
  };

  it('inRange is inclusive of both ends', () => {
    expect(inRange('2026-04-17', terms.current)).toBe(true);
    expect(inRange('2026-05-01', terms.current)).toBe(true);
    expect(inRange('2026-05-02', terms.current)).toBe(false);
    expect(inRange('2026-02-05', terms.previous)).toBe(false);
  });

  it('classifies a date into current, previous, or null (holiday gap)', () => {
    expect(classifyDate('2026-04-24', terms)).toBe('current');
    expect(classifyDate('2026-02-13', terms)).toBe('previous');
    expect(classifyDate('2026-03-20', terms)).toBeNull(); // in the gap
    expect(classifyDate('2026-06-01', terms)).toBeNull(); // after current
  });
});
