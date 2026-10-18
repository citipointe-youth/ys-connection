import type { BusEligibility, BusGender } from '../core/entities/bus';

export const PURGE_DAYS = 28;
const LATE_NIGHT_CUTOFF_HOUR = 6; // before 06:00 the previous evening's run is still "tonight"

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The phone's local day; before 06:00 still counts as the previous evening. */
export function localDay(localNow: string): string {
  const day = localNow.slice(0, 10);
  return Number(localNow.slice(11, 13) || '12') < LATE_NIGHT_CUTOFF_HOUR ? addDays(day, -1) : day;
}

export function isServiceDay(date: string, serviceDayOfWeek: number): boolean {
  return new Date(date + 'T00:00:00Z').getUTCDay() === serviceDayOfWeek;
}

/** localNow = the phone's local 'YYYY-MM-DDTHH:mm'. Returns the run date (service day) it belongs to. */
export function currentRunDate(localNow: string, serviceDayOfWeek: number): string {
  const day = localDay(localNow);
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

// I10 (2026-10-17): tidy the case of a new person's typed name.
// ponytail: only fixes all-lower / ALL-CAPS input; mixed case is trusted as typed. Mac* is not special-cased
// (Macy/Mack); van/de particles get capitalised. Upgrade: a particle list if asked.
export function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/\bMc(\p{L})/gu, (_, c: string) => 'Mc' + c.toUpperCase());
}

export function nameMatches(query: string, first: string, last: string): boolean {
  const f = normName(first), l = normName(last);
  return normName(query).split(' ').filter(Boolean).every((t) => f.startsWith(t) || l.startsWith(t));
}

export function riderKey(r: { studentId: string | null; guestId: string | null }): string {
  return r.studentId ? `s:${r.studentId}` : `g:${r.guestId}`;
}

/** Digits-only key for phone matching, comparing just the last 9 digits so a leading country
 *  code ('61') and a leading trunk '0' are equivalent (0412345678 / 61412345678 / +61412345678
 *  all → '412345678'). Returns null for anything too short to be a real number — a short/garbage
 *  value must never match. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}
export function phoneMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneKey(a);
  return !!ka && ka === phoneKey(b);
}

/** "24 Wynnum Rd, Carina QLD 4152, Australia" → "Carina". Falls back to the input. */
export function suburbOf(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return address.trim();
  return parts[1]!.replace(/\s+[A-Z]{2,3}\s+\d{4}$/, '').trim();
}

const STATES = 'QLD|NSW|VIC|SA|WA|TAS|NT|ACT';
const STREET_WORDS = /\b(st|street|rd|road|ave|avenue|ct|court|dr|drive|pde|parade|pl|place|cres|crescent|tce|terrace|hwy|highway|ln|lane|way|cl|close|cct|circuit|bvd|boulevard|esp|esplanade|unit|lot)\b/i;
// Real suburbs whose name holds a street word. Kept short and explicit: any other part with a
// street word stays blank. A leading "St "/"Saint " (St Lucia, St Kilda) is handled separately.
const STREET_WORD_SUBURBS = /^(petrie terrace|lane cove( north| west)?)$/i;
// "Suburb STATE" with an optional postcode: the Places autocomplete text the app stores has no
// postcode ("24 Wynnum Rd, Carina QLD, Australia").
const SUBURB_PART = new RegExp(`^([A-Za-z][A-Za-z' .-]*?)\\s+(?:${STATES})(?:\\s+\\d{4})?$`);

/** Strict suburb for logins that must never see a street: only a comma part shaped like
 *  "Suburb STATE" or "Suburb STATE 1234", with no digit or street word in the suburb. Unsure → "". */
export function suburbOnly(address: string): string {
  for (const part of address.split(',').map((p) => p.trim())) {
    const m = SUBURB_PART.exec(part);
    if (!m) continue;
    const sub = m[1]!.trim();
    if (/\d/.test(sub)) continue;
    if (STREET_WORD_SUBURBS.test(sub) || !STREET_WORDS.test(sub.replace(/^(St|Saint)\s+(?=[A-Z])/, ''))) return sub;
  }
  return '';
}

/** Task 3: "24 Wynnum Rd, Carina QLD 4152, Australia" → "24 Wynnum Rd" — the street part, used
 *  both as the default label for a new address saved with a blank label, and as a display
 *  fallback for an existing address whose label is still blank. Max 40 chars (NewAddress.label's
 *  own cap) so a default label never trips that schema limit. */
export function streetOf(address: string): string {
  const street = address.split(',')[0]?.trim() || address.trim();
  return street.slice(0, 40);
}

/** Same order as the SPA's BUS_CAR_COLOURS (spa-bus.test pins them equal) — the static map paints routes in these. */
export const BUS_CAR_COLOURS = ['#2563eb', '#db2777', '#059669', '#7c3aed', '#ea580c', '#0891b2', '#ca8a04', '#be123c'];
