// ID check rhythm (spec 2026-10-30 section 7.6): pure due-date and status maths on YYYY-MM-DD strings (UTC date maths).
export type IdCheckStatus = 'overdue' | 'never' | 'dueSoon' | 'onTrack';

const DAY_MS = 86_400_000;
const DUE_SOON_DAYS = 30;
const CATCH_UP_MONTHS = 2;

const parse = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y!, m!, d!];
};
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dayNo = (ymd: string) => { const [y, m, d] = parse(ymd); return Date.UTC(y, m - 1, d) / DAY_MS; };

/** Adds whole months, clamping to the month end (31 Aug + 6 = 28/29 Feb). */
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = parse(ymd);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${pad(ny, 4)}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}

/**
 * Next due day. `last` = the newest finished check's held_on (null = none).
 * No cycleStart: last + interval, or today when never checked. With a cycleStart, no check or one before it is due
 * cycleStart + 2 months (the catch-up window); otherwise last + interval.
 */
export function dueOn(today: string, cycleStart: string, intervalMonths: number, last: string | null): string {
  if (!cycleStart) return last ? addMonths(last, intervalMonths) : today;
  if (!last || last < cycleStart) return addMonths(cycleStart, CATCH_UP_MONTHS);
  return addMonths(last, intervalMonths);
}

/** overdue > never > dueSoon (30 days or fewer) > onTrack. */
export function statusOf(today: string, due: string, last: string | null): IdCheckStatus {
  if (today > due) return 'overdue';
  if (!last) return 'never';
  return dayNo(due) - dayNo(today) <= DUE_SOON_DAYS ? 'dueSoon' : 'onTrack';
}

/** Due ascending, then never before the rest on the same day, then name. Returns a new array. */
export function sortRows<T extends { dueOn: string; status: IdCheckStatus; name: string }>(rows: T[]): T[] {
  const never = (r: T) => (r.status === 'never' ? 0 : 1);
  return [...rows].sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : never(a) - never(b) || a.name.localeCompare(b.name)));
}
