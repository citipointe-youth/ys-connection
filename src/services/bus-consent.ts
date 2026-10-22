// Bus consent via the Elvanto public form (spec 2026-10-22 §5.2-5.4). Pure helpers + the push ingest. Never logs a name or value.
import { randomUUID } from 'node:crypto';
import { brisbaneToday, matchFold } from './link-rules';
import { mergeMinistryConfig } from '../core/ministry-config';
import type { BusConsentFormsPushBody } from '../core/link-contract';
import type { BusConsentData, BusConsentForm, BusConsentSubmit, BusConsentView, BusGuest } from '../core/entities/bus';
import type { Student } from '../core/entities/student';
import type { IBusRepository, ISettingsRepository, IStudentRepository } from '../repositories/interfaces/entity-repositories';

type Who = { studentId: string | null; guestId: string | null };
const PAIR_MS = 15 * 60_000; // an in-app submit and the form it made: same name, the submit up to 15 min before the form

/** R4: the calendar year of the instant in the site's zone. */
export const yearOf = (iso: string, tz: string): number => Number(brisbaneToday(new Date(iso), tz).slice(0, 4));
const key = (first: string, last: string) => `${matchFold(first)}|${matchFold(last)}`;

/** R5: exactly one student or unlinked bus guest with the same folded first + last. None or 2+ = null (unattached). */
export function matchOwner(first: string, last: string, students: Pick<Student, 'id' | 'firstName' | 'lastName'>[],
  guests: Pick<BusGuest, 'id' | 'firstName' | 'lastName' | 'linkedStudentId'>[]): Who | null {
  const k = key(first, last);
  const hits: Who[] = [...students.filter((s) => key(s.firstName, s.lastName) === k).map((s) => ({ studentId: s.id, guestId: null })),
    ...guests.filter((g) => !g.linkedStudentId && key(g.firstName, g.lastName) === k).map((g) => ({ studentId: null, guestId: g.id }))];
  return hits.length === 1 ? hits[0]! : null;
}
const mine = (forms: BusConsentForm[], who: Who) => forms
  .filter((f) => (who.studentId ? f.studentId === who.studentId : !!who.guestId && f.guestId === who.guestId))
  .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
/** The newest form on file for this person, any year (autofill, R6). */
export const latestForm = (forms: BusConsentForm[], who: Who): BusConsentForm | null => mine(forms, who)[0] ?? null;
/** The chip, plus details for a full (non-redacted) view. The newest current-year form supplies the details (R4). */
export function consentView(forms: BusConsentForm[], who: Who, year: number, full: boolean): BusConsentView {
  const cur = mine(forms, who).find((f) => f.year === year);
  if (!cur || !full) return { year, current: !!cur };
  const d = cur.data;
  const pickup = d.pickup === true ? 'parent' : String(d.pickupBy || '').trim() ? 'named' : 'dropHome';
  return { year, current: true, pickup, details: { formId: cur.id, submittedAt: cur.submittedAt, source: cur.source, filedBy: d.filedBy,
    parentName: d.parentName, parentPhone: d.parentPhone, address: d.address, pickup: d.pickup, pickupBy: d.pickupBy, school: d.school } };
}
const norm = (s: string) => s.toLowerCase().replace(/,?\s*australia\s*$/, '').replace(/\b(qld|nsw|vic|sa|wa|tas|nt|act)\b/g, '')
  .replace(/\b\d{4}\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** R8 hint: street line 1 + city against the rider's saved address text (state, postcode, case and spacing ignored). */
export function sameAddress(form: BusConsentData['address'], saved: string): boolean {
  return norm(`${form.line1} ${form.city}`) === norm(saved);
}

export async function ingestBusConsentForms(d: { bus: IBusRepository; students: IStudentRepository; settings: ISettingsRepository },
  req: BusConsentFormsPushBody, now = new Date()) {
  const s = await d.settings.getSettings();
  const tz = s.ministryConfig.structure.timeZone;
  const [existing, submits] = await Promise.all([d.bus.listConsentForms(), d.bus.listConsentSubmits()]);
  const byKey = new Map(existing.map((f) => [`${f.submissionId}:${f.childIndex}`, f]));
  const pairOf = (r: BusConsentFormsPushBody['rows'][number]): BusConsentSubmit | undefined => submits.find((x) => x.elvantoResult !== 'failed'
    && key(x.first, x.last) === key(r.first, r.last)
    && Date.parse(r.submittedAt) - Date.parse(x.submittedAt) >= -60_000 && Date.parse(r.submittedAt) - Date.parse(x.submittedAt) <= PAIR_MS);
  const rows: BusConsentForm[] = req.rows.map((r) => {
    const old = byKey.get(`${r.submissionId}:${r.childIndex}`), pair = old ? undefined : pairOf(r);
    return { id: old?.id ?? randomUUID(), submissionId: r.submissionId, childIndex: r.childIndex, submittedAt: r.submittedAt,
      year: yearOf(r.submittedAt, tz), studentId: old?.studentId ?? null, guestId: old?.guestId ?? null, first: r.first, last: r.last,
      source: old?.source ?? (pair ? 'app' : 'public'), createdAt: old?.createdAt ?? now.toISOString(),
      data: { grade: r.grade, gender: r.gender, mobile: r.mobile, school: r.school, address: r.address, parentName: r.parentName,
        parentPhone: r.parentPhone, pickup: r.pickup, pickupBy: r.pickupBy, filedBy: old?.data.filedBy ?? (pair ? pair.leaderName : null) } };
  });
  const added = await d.bus.upsertConsentForms(rows);
  const [all, students, guests] = await Promise.all([d.bus.listConsentForms(), d.students.findAll(), d.bus.listGuests()]);
  const open = all.filter((f) => !f.studentId && !f.guestId); // R5: unattached rows re-match on every push
  const changes = open.flatMap((f) => { const m = matchOwner(f.first, f.last, students, guests); return m ? [{ id: f.id, ...m }] : []; });
  if (changes.length) await d.bus.setConsentFormOwners(changes);
  const year = yearOf(now.toISOString(), tz);
  await d.bus.purgeConsentForms(year - 1, `${year - 1}-01-01T00:00:00.000Z`); // spec §5.2: keep last year and this year
  // ponytail: read-modify-write of app_settings; a Bus settings save in the same second could lose one of the two. Own row if that bites.
  await d.settings.updateSettings({ ministryConfig: mergeMinistryConfig((await d.settings.getSettings()).ministryConfig,
    { busMinistry: { consentLastChecked: req.checkedAt, consentLastNew: added } }) });
  return { applied: true as const, rows: rows.length, new: added, unmatched: open.length - changes.length };
}
