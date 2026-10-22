// This location's youth connect forms (public, no login). The Elvanto field names and option ids live in
// ministryConfig.elvanto (Youth Setup, filled by Check forms; Brisbane's came from migration 0040).
// If the church edits a form, shapeProblems() refuses before anything is sent (new-youth.service.ts).
import { gradeRange, DEFAULT_LOCATION_QUESTION, type ElvantoConfig, type MinistryConfig } from '../core/ministry-config';

export type Outcome = 'sent' | 'failed' | 'unconfirmed' | 'skipped';

export interface NewYouth {
  host: string;
  /** T4 (X19): the app's submission ref, `YS-` + 6 Crockford base32. Rides on the student form's host answer only, so the
   *  console pairs the student form with its parent form directly and marks the family "From app". Never logged. */
  ref?: string;
  firstName: string;
  lastName: string;
  dob: string; // dd/mm/yyyy, already checked by isoToDmy
  gender: 'm' | 'f';
  grade: string; // '7'..'12'
  school: string;
  mobile: string; // 04XXXXXXXX
  address?: { street: string; suburb: string; state: string; postcode: string };
  allergies: string[];
  conditions: string[];
  medicalNotes: string;
  parentFirst: string;
  parentLast: string;
  parentMobile: string;
  parentGender?: 'm' | 'f';
}

export type FormKind = 'student' | 'parent' | 'busConsent';
export const formUrl = (e: ElvantoConfig, kind: FormKind): string =>
  `${e.baseUrl}/form/${kind === 'student' ? e.studentFormId : kind === 'parent' ? e.parentFormId : e.busConsentFormId}`;

const S = 'submissions[0]';

// The keys the body builders read: e.fields[key] is an input name, e.options[key] an option id.
const FIELD_KEYS = ['host', 'givenBy', 'attending', 'school', 'allergies', 'conditions', 'medicalNotes',
  'parentName', 'parentPhone', 'withParent', 'contactedParent'] as const;
// attendRegular: operator 2026-10-11, everyone; "just visiting" is never sent.
const OPTION_KEYS = ['givenByChild', 'attendRegular', 'withParentNo', 'contactedYes', 'demoYouth', 'demoAdults', 'location'] as const;

// Labels exactly as the form shows them (including Elvanto's "Penicilin" spelling). Their ids are
// options['allergy:<label>'] / options['condition:<label>']; grades are options['grade<n>'].
export const LABELS = {
  allergies: ['Anaphylaxis', 'Asthmatic', 'Dairy Intolerance', 'Egg Allergy', 'Gluten Intolerance', 'Lactose Intolerance',
    'Nut Allergy', 'Penicilin Allergy', 'Skin Allergy', 'Sugar Allergy', 'Wheat Allergy'],
  conditions: ['ADHD', 'Autism/Aspergers', 'Diabetes Type 1', 'Epilepsy'],
} as const;

// P16: each key's Elvanto question label (and option label), read from the two public forms. Labels are code
// constants, the same across the tenant (decision 8); Check forms maps them to this location's ids.
const Q = {
  host: 'Name of Host filling out form', givenBy: 'This information is given by the',
  attending: 'Are you intending on regularly attending Youth Society or are you just visiting?',
  school: 'What school do you attend?', allergies: 'Allergies', conditions: 'Medical Conditions',
  medicalNotes: 'Medical Comments (other allergies and instructions)', parentName: 'Youth Parent Full Name',
  parentPhone: 'Youth Parent Phone Number', withParent: 'Young person is present with a parent/guardian',
  contactedParent: 'Young person has contacted parent',
} as const satisfies Record<(typeof FIELD_KEYS)[number], string>;
export const FIELD_LABELS = {
  fields: Q,
  // option key -> [question label, option label]; 'location' takes its option label from the location's setting.
  options: {
    givenByChild: [Q.givenBy, 'Child'], attendRegular: [Q.attending, 'I would like to regularly attend'],
    withParentNo: [Q.withParent, 'No'], contactedYes: [Q.contactedParent, 'Yes'],
    demoYouth: ['Demographics', 'Youth'], demoAdults: ['Demographics', 'Adults'],
    ...Object.fromEntries([6, 7, 8, 9, 10, 11, 12].map((g) => [`grade${g}`, ['School Grade', String(g)]])),
    ...Object.fromEntries(LABELS.allergies.map((l) => [`allergy:${l}`, [Q.allergies, l]])),
    ...Object.fromEntries(LABELS.conditions.map((l) => [`condition:${l}`, [Q.conditions, l]])),
  } as Record<string, readonly [string, string]>,
  location: DEFAULT_LOCATION_QUESTION, // the default; each location's own label is elvanto.locationQuestion (F7)
};

export interface FormField { label: string; name: string; options: { label: string; value: string }[] }

const text = (s: string) => s.replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const attr = (tag: string, a: string) => new RegExp(`\\b${a}="([^"]*)"`).exec(tag)?.[1];

/** Each labelled question on a public form: its label, its input name and its options (markup as the fixtures). */
export function readFormFields(html: string): FormField[] {
  return html.split('<label class="control-label">').slice(1).map((chunk) => {
    const label = text(chunk.slice(0, chunk.indexOf('<')));
    const name = [...chunk.matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]!).find((n) => !n.startsWith('multi_select_filter_')) ?? '';
    const options: FormField['options'] = [];
    for (const m of chunk.matchAll(/<(option|input)\b([^>]*)>([^<]*)/g)) {
      const value = attr(m[2]!, 'value');
      if (value && (m[1] === 'option' || attr(m[2]!, 'name') === name)) options.push({ label: text(m[3]!), value });
    }
    return { label, name, options };
  });
}

export interface FormCheck {
  ok: boolean; n: number; fields: Record<string, string>; options: Record<string, string>;
  missing: string[]; extra: string[]; lines: string[];
  /** The draft key ('fields.<k>' / 'options.<k>') of each `missing` row, same order: the card types an id there. */
  missingKeys: string[];
}

/** Check forms: map every key by label on both forms. `grades` are the ones this location sends (they must be found);
 *  other grades are mapped when present. The result is returned, never saved. */
export function checkForms(studentHtml: string, parentHtml: string, location: string, grades: number[],
  locationQuestion: string = FIELD_LABELS.location): FormCheck {
  const qs = [...readFormFields(studentHtml), ...readFormFields(parentHtml)];
  const q = (label: string) => qs.find((f) => f.label === label);
  const fields: Record<string, string> = {}, options: Record<string, string> = {}, missing: string[] = [], missingKeys: string[] = [];
  let n = 0;
  for (const [k, label] of Object.entries(FIELD_LABELS.fields)) {
    n++;
    const f = q(label);
    if (f?.name) fields[k] = f.name; else { missing.push(label); missingKeys.push(`fields.${k}`); }
  }
  const opts: [string, readonly [string, string]][] = [...Object.entries(FIELD_LABELS.options), ['location', [locationQuestion, location]]];
  for (const [k, [ql, ol]] of opts) {
    const need = !/^grade\d+$/.test(k) || grades.includes(Number(k.slice(5)));
    if (need) n++;
    const v = ol && q(ql)?.options.find((o) => o.label === ol)?.value;
    if (v) options[k] = v; else if (need) { missing.push(ol ? `${ql}, option ${ol}` : ql); missingKeys.push(`options.${k}`); }
  }
  // A labelled question neither body posts (a new required one would make every send fail, as shapeProblems says).
  const e = { fields, options } as ElvantoConfig;
  const y = { allergies: [], conditions: [] } as unknown as NewYouth;
  const posted = new Set([...studentBody(y, '', e).keys(), ...parentBody(y, '', e).keys(), fields.allergies, fields.conditions]);
  const extra = [...new Set(qs.filter((f) => f.name && !posted.has(f.name)).map((f) => f.label))];
  const lines = [
    ...(missing.length ? missing.map((m) => `Not found: ${m}. Make the question match, or type its id.`) : [`All ${n} found.`]),
    ...extra.map((l) => `This form asks something the app doesn't fill: ${l}.`),
  ];
  return { ok: !missing.length && !extra.length, n, fields, options, missing, missingKeys, extra, lines };
}

// Bus consent form (spec 2026-10-22 bus consent, snapshot labels). Keys live in the same fields/options records with a bc prefix.
const BQ = { bcSchool: 'What school do you attend?', bcParentName: 'Parent Full Name', bcParentPhone: 'Parent Phone Number',
  bcPickup: 'Will you be picking up your child from the drop-off location?', bcPickupBy: 'Who will be picking up your child?' } as const;
const BUS_GRADES = [6, 7, 8, 9, 10, 11, 12];
export interface BusConsentIn { first: string; last: string; grade: string; gender: 'm' | 'f'; mobile: string; school: string;
  address: { line1: string; line2: string; postcode: string; city: string; state: string };
  parentName: string; parentPhone: string; pickup: boolean; pickupBy: string }

export function checkBusForm(html: string, grades: number[]): FormCheck {
  const qs = readFormFields(html), q = (l: string) => qs.find((f) => f.label === l);
  const fields: Record<string, string> = {}, options: Record<string, string> = {}, missing: string[] = [], missingKeys: string[] = [];
  let n = 0;
  for (const [k, l] of Object.entries(BQ)) { n++; const f = q(l); if (f?.name) fields[k] = f.name; else { missing.push(l); missingKeys.push(`fields.${k}`); } }
  const opts: [string, string, string][] = [['bcPickupYes', BQ.bcPickup, 'Yes'], ['bcPickupNo', BQ.bcPickup, 'No'],
    ...BUS_GRADES.map((g): [string, string, string] => [`bcGrade${g}`, 'School Grade', String(g)])];
  for (const [k, ql, ol] of opts) {
    const need = !k.startsWith('bcGrade') || grades.includes(Number(k.slice(7)));
    if (need) n++;
    const v = q(ql)?.options.find((o) => o.label === ol)?.value;
    if (v) options[k] = v; else if (need) { missing.push(`${ql}, option ${ol}`); missingKeys.push(`options.${k}`); }
  }
  const lines = missing.length ? missing.map((m) => `Bus consent form: not found: ${m}. Make the question match, or type its id.`) : [`Bus consent form: all ${n} found.`];
  return { ok: !missing.length, n, fields, options, missing, missingKeys, extra: [], lines };
}
export function elvantoBusReady(cfg: Pick<MinistryConfig, 'elvanto' | 'structure'>): boolean {
  const e = cfg.elvanto;
  return !!(e.baseUrl && e.busConsentFormId) && Object.keys(BQ).every((k) => !!e.fields[k])
    && ['bcPickupYes', 'bcPickupNo', ...gradeRange(cfg.structure).map((g) => `bcGrade${g}`)].every((k) => !!e.options[k]);
}
export function busConsentBody(b: BusConsentIn, honeypot: string, e: ElvantoConfig): URLSearchParams {
  const F = e.fields, O = e.options, x = new URLSearchParams();
  x.append('save', '1');
  x.append(`${S}[first_name]`, b.first);
  x.append(`${S}[last_name]`, b.last);
  x.append(`${S}[school_grade]`, O[`bcGrade${b.grade}`] ?? '');
  x.append(`${S}[gender]`, b.gender);
  x.append(`${S}[mobile_number]`, b.mobile);
  x.append(F.bcSchool ?? '', b.school);
  x.append(`${S}[home_address]`, b.address.line1);
  x.append(`${S}[home_address2]`, b.address.line2.trim() || '-'); // Elvanto marks Line 2 required
  x.append(`${S}[home_postcode]`, b.address.postcode);
  x.append(`${S}[home_city]`, b.address.city);
  x.append(`${S}[home_state]`, b.address.state.trim() || 'QLD');
  x.append(F.bcParentName ?? '', b.parentName);
  x.append(F.bcParentPhone ?? '', b.parentPhone);
  x.append(F.bcPickup ?? '', (b.pickup ? O.bcPickupYes : O.bcPickupNo) ?? '');
  x.append(F.bcPickupBy ?? '', b.pickup ? '' : b.pickupBy); // Elvanto shows this only when pickup = No
  x.append(honeypot, '');
  x.append('url', '');
  return x;
}
/** The drop-off location from the success page. Never throws; null when not found. */
// The form's success message names no drop-off location (Task 0 capture), so there is nothing to parse: always null.
const DROPOFF_RE: RegExp | null = null;
export function dropoffOf(html: string): string | null {
  try { const m = DROPOFF_RE ? DROPOFF_RE.exec(String(html ?? '')) : null; return m?.[1] ? text(m[1]).slice(0, 200) : null; } catch { return null; }
}

/** True when every key the body builders read is set (grade6 only when "Include Grade 6" is on). */
export function elvantoReady(cfg: Pick<MinistryConfig, 'elvanto' | 'structure'>): boolean {
  const e = cfg.elvanto;
  const opts = [...OPTION_KEYS, ...gradeRange(cfg.structure).map((g) => `grade${g}`),
    ...LABELS.allergies.map((l) => `allergy:${l}`), ...LABELS.conditions.map((l) => `condition:${l}`)];
  return !!(e.baseUrl && e.studentFormId && e.parentFormId)
    && FIELD_KEYS.every((k) => !!e.fields[k]) && opts.every((k) => !!e.options[k]);
}

// Bare 04 digits: Elvanto's parent-phone field refuses spaces (11.1 hotfix 1bd39c6).
export function toAuMobile(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('61')) d = d.slice(2); // +61 412…, 61412…, and the common "+61 0412…"
  if (d.length === 9 && d.startsWith('4')) d = `0${d}`;
  return /^04\d{8}$/.test(d) ? d : null;
}

// A port of 11.1's capName (Project 11.1 src/youth-plan.js), so 11.1 never offers a capital fix on a form
// this app sent: a name starting lower-case or in ALL CAPS gets a capital at the start and after a space,
// hyphen, apostrophe or full stop; anything else is kept as typed. Runs of spaces are collapsed first.
export function tidyName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  const lower = /^\p{Ll}/u.test(s), caps = (s.match(/\p{L}/gu) || []).length >= 2 && !/\p{Ll}/u.test(s);
  if (!lower && !caps) return s;
  return (caps ? s.toLowerCase() : s).replace(/(^|[\s'’.-])(\p{Ll})/gu, (_m, a: string, b: string) => a + (b.toUpperCase().length === 1 ? b.toUpperCase() : b));
}

// <input type="date"> gives YYYY-MM-DD; Elvanto wants dd/mm/yyyy. Youth only: age 9 to 20.
export function isoToDmy(iso: string, today: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const age = (today.getTime() - dt.getTime()) / (365.25 * 864e5);
  if (age < 9 || age >= 21) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function studentBody(y: NewYouth, honeypot: string, e: ElvantoConfig): URLSearchParams {
  const F = e.fields, O = e.options;
  const b = new URLSearchParams();
  b.append('save', '1');
  b.append(F.host ?? '', y.ref ? `${y.host} (${y.ref})` : y.host); // the console reads /\((YS-[0-9A-HJKMNP-TV-Z]{6})\)\s*$/
  b.append(F.givenBy ?? '', O.givenByChild ?? '');
  b.append(F.attending ?? '', O.attendRegular ?? '');
  b.append(`${S}[first_name]`, y.firstName);
  b.append(`${S}[birthday]`, y.dob);
  b.append(F.school ?? '', y.school);
  b.append(`${S}[mobile_number]`, y.mobile);
  b.append(`${S}[mailing_address]`, y.address?.street ?? '');
  b.append(`${S}[mailing_city]`, y.address?.suburb ?? '');
  b.append(`${S}[demographic][]`, O.demoYouth ?? '');
  b.append(`${S}[last_name]`, y.lastName);
  b.append(`${S}[gender]`, y.gender);
  b.append(`${S}[school_grade]`, O[`grade${y.grade}`] ?? '');
  b.append(`${S}[email]`, '');
  b.append(`${S}[mailing_state]`, y.address?.state ?? '');
  b.append(`${S}[mailing_postcode]`, y.address?.postcode ?? '');
  b.append(`${S}[location][]`, O.location ?? '');
  for (const a of y.allergies) b.append(F.allergies ?? '', O[`allergy:${a}`] ?? '');
  for (const c of y.conditions) b.append(F.conditions ?? '', O[`condition:${c}`] ?? '');
  b.append(F.medicalNotes ?? '', y.medicalNotes);
  b.append(F.parentName ?? '', `${y.parentFirst} ${y.parentLast}`);
  b.append(F.parentPhone ?? '', y.parentMobile);
  b.append(F.withParent ?? '', O.withParentNo ?? '');
  b.append(F.contactedParent ?? '', O.contactedYes ?? '');
  b.append(honeypot, '');
  b.append('url', '');
  return b;
}

export function parentBody(y: NewYouth, honeypot: string, e: ElvantoConfig): URLSearchParams {
  const O = e.options;
  const b = new URLSearchParams();
  b.append('save', '1');
  b.append(`${S}[first_name]`, y.parentFirst);
  b.append(`${S}[last_name]`, y.parentLast);
  b.append(`${S}[mobile_number]`, y.parentMobile);
  b.append(`${S}[demographic][]`, O.demoAdults ?? '');
  b.append(`${S}[gender]`, y.parentGender ?? '');
  b.append(`${S}[email]`, '');
  b.append(`${S}[location][]`, O.location ?? '');
  b.append(honeypot, '');
  b.append('url', '');
  return b;
}

export function honeypotName(html: string): string | null {
  return /name="(elvanto\d+)"/.exec(html)?.[1] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The live form must match what we post, both ways:
// - every field we post exists, and every option id we post is offered;
// - every input the form has is one we post (a new required question or a second honeypot would
//   otherwise make every send fail with advice the host can't follow). Reported as "new:<name>".
export function shapeProblems(html: string, body: URLSearchParams, e: ElvantoConfig): string[] {
  const problems = new Set<string>();
  // Ticked-only lists: absent from the body when nothing is ticked, but known.
  const listKeys = new Set([e.fields.allergies, e.fields.conditions]);
  for (const [k, v] of body) {
    if (!html.includes(`name="${k}"`)) problems.add(k);
    if (UUID.test(v) && !html.includes(`value="${v}"`)) problems.add(`${k}=${v}`);
  }
  for (const m of html.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)) {
    const n = m[1]!;
    if (!body.has(n) && !listKeys.has(n) && !n.startsWith('multi_select_filter_')) problems.add(`new:${n}`);
  }
  return [...problems];
}

// Optional per-form success rules. With none set, an accepted-looking reply (a redirect, or a 200 that
// isn't the form again) is 'sent': owner 2026-10-12, after a live test landed both forms in Elvanto.
export const SUCCESS: Record<FormKind, { redirect: RegExp | null; marker: string | null }> = {
  student: { redirect: null, marker: null },
  parent: { redirect: null, marker: null },
  busConsent: { redirect: null, marker: 'Thank you so much for completing this form' }, // the form's custom success message (Task 0); a miss is 'unconfirmed'
};

/** Case and whitespace tolerant (and tag-free) marker match. */
const markerIn = (body: string, marker: string): boolean => {
  const n = (x: string) => x.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\s+/g, ' ').toLowerCase();
  return n(body).includes(n(marker));
};

export function classifyPost(form: FormKind, r: { status: number; location: string | null; body: string }): Outcome {
  const ok = SUCCESS[form];
  if (r.status >= 300 && r.status < 400) {
    return ok.redirect && !ok.redirect.test(r.location ?? '') ? 'unconfirmed' : 'sent';
  }
  if (r.status >= 500) return 'unconfirmed'; // Elvanto may have saved it before erroring
  if (r.status !== 200) return 'failed';
  if (ok.marker && markerIn(r.body, ok.marker)) return 'sent';
  if (r.body.includes('name="save"')) return 'failed'; // the form came back: Elvanto refused it
  return ok.marker ? 'unconfirmed' : 'sent';
}
