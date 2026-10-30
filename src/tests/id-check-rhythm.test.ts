import { describe, it, expect } from 'vitest';
import { addMonths, dueOn, statusOf, sortRows } from '../services/id-check-rhythm';

const T = '2026-10-30';

describe('addMonths', () => {
  it('clamps to month end', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-10-15', 4)).toBe('2027-02-15');
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
  });
});

describe('dueOn', () => {
  it('start unset: last + interval, or today when never checked', () => {
    expect(dueOn(T, '', 6, null)).toBe(T);
    expect(dueOn(T, '', 6, '2026-05-01')).toBe('2026-11-01');
  });
  it('catch-up window: no check, or a check before the start, is due start + 2 months', () => {
    expect(dueOn(T, '2026-11-01', 6, null)).toBe('2027-01-01');
    expect(dueOn(T, '2026-11-01', 6, '2026-10-01')).toBe('2027-01-01');
  });
  it('normal: last + interval', () => {
    expect(dueOn(T, '2026-01-01', 4, '2026-06-15')).toBe('2026-10-15');
    expect(dueOn(T, '2026-01-01', 4, '2026-01-01')).toBe('2026-05-01');
  });
});

describe('statusOf', () => {
  it('overdue beats never; never beats dueSoon and onTrack', () => {
    expect(statusOf(T, '2026-10-29', '2026-04-01')).toBe('overdue');
    expect(statusOf(T, '2026-10-29', null)).toBe('overdue');
    expect(statusOf(T, '2027-01-01', null)).toBe('never'); // start in the future, no check ever
    expect(statusOf(T, T, null)).toBe('never');
  });
  it('30 days exactly is dueSoon, 31 is onTrack, due today is not overdue', () => {
    expect(statusOf(T, '2026-11-29', '2026-05-29')).toBe('dueSoon');
    expect(statusOf(T, '2026-11-30', '2026-05-30')).toBe('onTrack');
    expect(statusOf(T, T, '2026-04-30')).toBe('dueSoon');
  });
});

describe('sortRows', () => {
  it('sorts by due, then never first on the same day, then name; does not mutate', () => {
    const rows = [
      { dueOn: '2026-11-01', status: 'dueSoon' as const, name: 'Zed' },
      { dueOn: '2026-10-01', status: 'overdue' as const, name: 'Mid' },
      { dueOn: '2026-11-01', status: 'never' as const, name: 'Yan' },
      { dueOn: '2026-11-01', status: 'dueSoon' as const, name: 'Abe' },
    ];
    const before = [...rows];
    expect(sortRows(rows).map((r) => r.name)).toEqual(['Mid', 'Yan', 'Abe', 'Zed']);
    expect(rows).toEqual(before);
  });
});
