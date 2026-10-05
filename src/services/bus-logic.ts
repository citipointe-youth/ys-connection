import type { BusEligibility, BusGender } from '../core/entities/bus';

export const PURGE_DAYS = 28;
const LATE_NIGHT_CUTOFF_HOUR = 6; // before 06:00 the previous evening's run is still "tonight"

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** localNow = the phone's local 'YYYY-MM-DDTHH:mm'. Returns the run date (service day) it belongs to. */
export function currentRunDate(localNow: string, serviceDayOfWeek: number): string {
  let day = localNow.slice(0, 10);
  const hour = Number(localNow.slice(11, 13) || '12');
  if (hour < LATE_NIGHT_CUTOFF_HOUR) day = addDays(day, -1);
  const dow = new Date(day + 'T00:00:00Z').getUTCDay();
  return addDays(day, (serviceDayOfWeek - dow + 7) % 7);
}

/** Who a car can take, from its leaders' genders. unknown = no leader with a known gender. */
export function eligibilityOf(leaderGenders: (BusGender | undefined)[]): BusEligibility {
  const female = leaderGenders.includes('female');
  const male = leaderGenders.includes('male');
  return { female, male, unknown: !female && !male };
}

export function capacityOf(seats: number, leaderCount: number): number {
  return Math.max(0, seats - leaderCount);
}

export function normName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function nameMatches(query: string, first: string, last: string): boolean {
  const f = normName(first), l = normName(last);
  return normName(query).split(' ').filter(Boolean).every((t) => f.startsWith(t) || l.startsWith(t));
}

export function riderKey(r: { studentId: string | null; guestId: string | null }): string {
  return r.studentId ? `s:${r.studentId}` : `g:${r.guestId}`;
}

/** "24 Wynnum Rd, Carina QLD 4152, Australia" → "Carina". Falls back to the input. */
export function suburbOf(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return address.trim();
  return parts[1]!.replace(/\s+[A-Z]{2,3}\s+\d{4}$/, '').trim();
}
