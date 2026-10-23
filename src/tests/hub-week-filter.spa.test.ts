// Consent hub week filter (2026-10-24): Current week / Last week / All, Monday to Sunday.
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const F = loadFns(['_lkAddDays', '_lkWeekStart', '_hubInWeek']);
const TODAY = '2026-10-24'; // a Saturday: this week is Mon 19 Oct - Sun 25 Oct

describe('hub week filter', () => {
  it('Current week = Monday to Sunday of today', () => {
    expect(F._hubInWeek('2026-10-19', 'cur', TODAY)).toBe(true);
    expect(F._hubInWeek('2026-10-25', 'cur', TODAY)).toBe(true);
    expect(F._hubInWeek('2026-10-18', 'cur', TODAY)).toBe(false);
    expect(F._hubInWeek('2026-10-26', 'cur', TODAY)).toBe(false);
  });
  it('Last week = the Monday to Sunday before', () => {
    expect(F._hubInWeek('2026-10-12', 'last', TODAY)).toBe(true);
    expect(F._hubInWeek('2026-10-18', 'last', TODAY)).toBe(true);
    expect(F._hubInWeek('2026-10-11', 'last', TODAY)).toBe(false);
    expect(F._hubInWeek('2026-10-19', 'last', TODAY)).toBe(false);
  });
  it('All shows everything, a row with no date only under All', () => {
    expect(F._hubInWeek('2025-01-01', 'all', TODAY)).toBe(true);
    expect(F._hubInWeek(null, 'all', TODAY)).toBe(true);
    expect(F._hubInWeek(null, 'cur', TODAY)).toBe(false);
    expect(F._hubInWeek('', 'last', TODAY)).toBe(false);
  });
});
