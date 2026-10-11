// The Citipointe Brisbane youth connect forms (public, no login), as fetched 2026-10-11.
// Every Elvanto field name and option id lives here. If the church edits a form,
// shapeProblems() refuses before anything is sent (new-youth.service.ts).
// ponytail: one location hard-coded; move these into ministryConfig when a second location forks.

export type Outcome = 'sent' | 'failed' | 'unconfirmed' | 'skipped';

export interface NewYouth {
  host: string;
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

export const ELVANTO_BASE = 'https://citipointe.elvanto.com.au';
export const STUDENT_FORM_ID = '45803e81-0c8f-4398-9891-3287df77ab91';
export const PARENT_FORM_ID = 'f10f6d33-7dc1-440c-aa62-c7e407138ef6';
export const formUrl = (id: string): string => `${ELVANTO_BASE}/form/${id}`;

const S = 'submissions[0]';
const FC = (id: string): string => `${S}[forms_custom_field][${id}]`;
const PC = (id: string): string => `${S}[people_custom_field][${id}]`;

const F = {
  host: FC('70d2227e-1a78-47c0-be6d-4fd8ddc12735'),
  givenBy: FC('4c438bd3-d34e-4e21-bfa5-2ceeb60064bc'),
  attending: FC('508f3b2c-58c9-4a96-b299-2666c706831b'),
  school: PC('45928c2c-37f0-11e1-9229-ea942707ad51'),
  allergies: `${PC('de842f02-366b-11e1-9229-ea942707ad51')}[]`,
  conditions: `${PC('24ec0de9-1bfb-4268-9f95-2c2c52adda28')}[]`,
  medicalNotes: PC('f62c3b36-366b-11e1-9229-ea942707ad51'),
  parentName: PC('bab736a4-dbe8-4a0c-ae3e-7c2c5799f9a3'),
  parentPhone: PC('c184c020-76ce-11e5-9d36-06ba798128be'),
  withParent: FC('739c2f1d-19cb-442a-9d81-aa6b2de6e7a9'),
  contactedParent: FC('6da70308-7365-46d2-b30c-e91b275c1359'),
} as const;

const OPT = {
  givenByChild: '575602b7-2cfc-41be-a18a-4d37b9a006e4',
  attendRegular: 'a6004ba1-0199-4f77-b833-0fd99ab22d1f', // operator 2026-10-11: everyone, "just visiting" is never sent
  withParentNo: '8270a2b8-76d3-426c-9ac7-a7ef632e07b0',
  contactedYes: '1c0d32b8-ef70-46e5-aa47-af4410c4219b',
  demoYouth: '428c8fa0-090b-11e1-9229-ea942707ad51',
  demoAdults: '428c637c-090b-11e1-9229-ea942707ad51',
  locBrisbane: '33bec66a-20bb-11e1-9229-ea942707ad51',
} as const;

export const GRADES: Record<string, string> = {
  '7': '807cac70-3825-11e1-9229-ea942707ad51',
  '8': '807cbbb6-3825-11e1-9229-ea942707ad51',
  '9': '807ccf48-3825-11e1-9229-ea942707ad51',
  '10': '807ce56e-3825-11e1-9229-ea942707ad51',
  '11': '807cfbf8-3825-11e1-9229-ea942707ad51',
  '12': '807d108e-3825-11e1-9229-ea942707ad51',
};

// Labels exactly as the form shows them (including Elvanto's "Penicilin" spelling).
export const ALLERGIES: Record<string, string> = {
  'Anaphylaxis': '5603d8b4-3736-11e1-9229-ea942707ad51',
  'Asthmatic': 'de848312-366b-11e1-9229-ea942707ad51',
  'Dairy Intolerance': '56044380-3736-11e1-9229-ea942707ad51',
  'Egg Allergy': 'd6b1eebb-7133-42fe-8615-23aaba311f4b',
  'Gluten Intolerance': 'de8474bc-366b-11e1-9229-ea942707ad51',
  'Lactose Intolerance': '6bc1cea5-018b-404d-917a-38b4e3e24a54',
  'Nut Allergy': 'de84578e-366b-11e1-9229-ea942707ad51',
  'Penicilin Allergy': 'de84677e-366b-11e1-9229-ea942707ad51',
  'Skin Allergy': '5604e90c-3736-11e1-9229-ea942707ad51',
  'Sugar Allergy': 'ee28892c-9bba-4d70-9d40-331f47c73076',
  'Wheat Allergy': 'cd80a9cf-ed3b-4b45-8b96-f625ea618984',
};

export const CONDITIONS: Record<string, string> = {
  'ADHD': '9e950f27-cc7e-4d52-8830-f571876478f5',
  'Autism/Aspergers': 'b553987f-2a35-4192-b49e-2452741bd477',
  'Diabetes Type 1': '4b1c793c-c907-4acf-83d7-137c261109ff',
  'Epilepsy': '37267e16-aaeb-4408-a7d3-f10dfd496555',
};

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

export function studentBody(y: NewYouth, honeypot: string): URLSearchParams {
  const b = new URLSearchParams();
  b.append('save', '1');
  b.append(F.host, y.host);
  b.append(F.givenBy, OPT.givenByChild);
  b.append(F.attending, OPT.attendRegular);
  b.append(`${S}[first_name]`, y.firstName);
  b.append(`${S}[birthday]`, y.dob);
  b.append(F.school, y.school);
  b.append(`${S}[mobile_number]`, y.mobile);
  b.append(`${S}[mailing_address]`, y.address?.street ?? '');
  b.append(`${S}[mailing_city]`, y.address?.suburb ?? '');
  b.append(`${S}[demographic][]`, OPT.demoYouth);
  b.append(`${S}[last_name]`, y.lastName);
  b.append(`${S}[gender]`, y.gender);
  b.append(`${S}[school_grade]`, GRADES[y.grade] ?? '');
  b.append(`${S}[email]`, '');
  b.append(`${S}[mailing_state]`, y.address?.state ?? '');
  b.append(`${S}[mailing_postcode]`, y.address?.postcode ?? '');
  b.append(`${S}[location][]`, OPT.locBrisbane);
  for (const a of y.allergies) b.append(F.allergies, ALLERGIES[a] ?? '');
  for (const c of y.conditions) b.append(F.conditions, CONDITIONS[c] ?? '');
  b.append(F.medicalNotes, y.medicalNotes);
  b.append(F.parentName, `${y.parentFirst} ${y.parentLast}`);
  b.append(F.parentPhone, y.parentMobile);
  b.append(F.withParent, OPT.withParentNo);
  b.append(F.contactedParent, OPT.contactedYes);
  b.append(honeypot, '');
  b.append('url', '');
  return b;
}

export function parentBody(y: NewYouth, honeypot: string): URLSearchParams {
  const b = new URLSearchParams();
  b.append('save', '1');
  b.append(`${S}[first_name]`, y.parentFirst);
  b.append(`${S}[last_name]`, y.parentLast);
  b.append(`${S}[mobile_number]`, y.parentMobile);
  b.append(`${S}[demographic][]`, OPT.demoAdults);
  b.append(`${S}[gender]`, y.parentGender ?? '');
  b.append(`${S}[email]`, '');
  b.append(`${S}[location][]`, OPT.locBrisbane);
  b.append(honeypot, '');
  b.append('url', '');
  return b;
}

export function honeypotName(html: string): string | null {
  return /name="(elvanto\d+)"/.exec(html)?.[1] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Ticked-only lists: absent from the body when nothing is ticked, but known.
const LIST_KEYS = new Set<string>([F.allergies, F.conditions]);

// The live form must match what we post, both ways:
// - every field we post exists, and every option id we post is offered;
// - every input the form has is one we post (a new required question or a second honeypot would
//   otherwise make every send fail with advice the host can't follow). Reported as "new:<name>".
export function shapeProblems(html: string, body: URLSearchParams): string[] {
  const problems = new Set<string>();
  for (const [k, v] of body) {
    if (!html.includes(`name="${k}"`)) problems.add(k);
    if (UUID.test(v) && !html.includes(`value="${v}"`)) problems.add(`${k}=${v}`);
  }
  for (const m of html.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)) {
    const n = m[1]!;
    if (!body.has(n) && !LIST_KEYS.has(n) && !n.startsWith('multi_select_filter_')) problems.add(`new:${n}`);
  }
  return [...problems];
}

export type FormKind = 'student' | 'parent';

// Optional per-form success rules. With none set, an accepted-looking reply (a redirect, or a 200 that
// isn't the form again) is 'sent': owner 2026-10-12, after a live test landed both forms in Elvanto.
export const SUCCESS: Record<FormKind, { redirect: RegExp | null; marker: string | null }> = {
  student: { redirect: null, marker: null },
  parent: { redirect: null, marker: null },
};

export function classifyPost(form: FormKind, r: { status: number; location: string | null; body: string }): Outcome {
  const ok = SUCCESS[form];
  if (r.status >= 300 && r.status < 400) {
    return ok.redirect && !ok.redirect.test(r.location ?? '') ? 'unconfirmed' : 'sent';
  }
  if (r.status >= 500) return 'unconfirmed'; // Elvanto may have saved it before erroring
  if (r.status !== 200) return 'failed';
  if (ok.marker && r.body.includes(ok.marker)) return 'sent';
  if (r.body.includes('name="save"')) return 'failed'; // the form came back: Elvanto refused it
  return ok.marker ? 'unconfirmed' : 'sent';
}
