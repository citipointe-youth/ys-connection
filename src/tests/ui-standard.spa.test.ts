// UI standard 2026-10-18 (ux-run-2026-10-18/REVIEW.md F): fmtDay is the one date format.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

describe('fmtDay', () => {
  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };
  it('"Fri 16 Oct"; the year only when not this year (Brisbane); time only when asked and only for an instant', () => {
    at('2026-10-18T00:00:00Z');
    const { fmtDay } = loadFns(['fmtDay']);
    expect(fmtDay('2026-10-16')).toBe('Fri 16 Oct');
    expect(fmtDay('2025-10-16')).toBe('Thu 16 Oct 2025');
    expect(fmtDay('2026-10-16', true)).toBe('Fri 16 Oct'); // a calendar day never gets a time
    expect(fmtDay('2026-09-18T09:00:00+10:00', true)).toBe('Fri 18 Sep, 9am');
    expect(fmtDay('2026-10-16T06:31:00Z', true)).toBe('Fri 16 Oct, 4:31pm'); // UTC instant shown in Brisbane
    expect(fmtDay('2026-10-16T14:05:00Z')).toBe('Sat 17 Oct'); // past midnight in Brisbane
    expect(fmtDay(new Date('2026-10-16T00:00:00Z'), true)).toBe('Fri 16 Oct, 10am');
    expect(fmtDay('')).toBe('');
    expect(fmtDay(null)).toBe('');
    expect(fmtDay('16/10/2026')).toBe('');
  });
  it('the year rule follows Brisbane New Year, not UTC', () => {
    at('2026-12-31T15:00:00Z'); // 1 Jan 2027 01:00 Brisbane
    expect(loadFns(['fmtDay']).fmtDay('2026-12-31')).toBe('Thu 31 Dec 2026');
  });
});

describe('shared markup', () => {
  const html = loadIndexHtml();
  it('no hand-rolled dd/mm/yyyy, no lk-row-act spacer, no ik-srch search', () => {
    expect(html).not.toContain("split('-').reverse().join('/')");
    expect(html).not.toContain('lk-row-act');
    expect(html).not.toContain('ik-srch');
  });
  it('.pg clears the nav from --nav-h, not a literal', () => {
    expect(html).toMatch(/\.pg\{[^}]*calc\(var\(--nav-h\) \+ var\(--s3\) \+ var\(--safe-b\)\)/);
  });
});
