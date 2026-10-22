// Connection Audit: one Elvanto export (a cell table) -> typed rows (spec ys-connection/2026-10-22-connection-audit §5.2).
// Pure. The console push and the admin manual upload both land here: the one implementation of Elvanto columns.
import type { AuditSource, AuditTable } from '../core/entities/connection-audit';
import { addDays, brisbaneToday } from './link-rules';

export interface AuditParseCtx { exportedAt: string; timeZone: string; dateOrder: 'DMY' | 'MDY'; leaderTag: RegExp | null;
  gradeRange: { min: number; max: number } }
export interface AuditPerson { first: string; last: string; preferred: string | null; gender: 'male' | 'female' | null;
  grade: number | null; phone: string | null; phoneIsParent: boolean }
/** dates = ISO days attended (service/team/group); marked = group days with any mark (Y or N); submitted = a form's day. */
export interface AuditRow { person: AuditPerson; dates: string[]; marked?: string[]; group?: string; submitted?: string }
export type AuditSkip = { reason: 'no-name' | 'bad-date'; name: string | null };
export type AuditNote = { note: 'no-gender-column' | 'bad-date-column' | 'grade-out-of-range'; count: number };
export type AuditParseResult = { shape: true; missing: string } | { shape: false; rows: AuditRow[]; skipped: AuditSkip[]; notes: AuditNote[] };

/** import.leaderTag as a regex, the same construction as import.service.ts:596-597 ("(Leader)", "(Assistant leaders)"). */
export function leaderTagRe(tag: string): RegExp {
  const t = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\(\\s*(?:assistant\\s+)?${t}s?\\s*\\)`, 'i');
}

const ALIASES = {
  first: ['first name', 'firstname', 'first_name'],
  last: ['last name', 'lastname', 'last_name', 'surname'],
  preferred: ['preferred name', 'preferred'],
  gender: ['gender'],
  grade: ['grade', 'school grade', 'year', 'what grade are you in?'], // the last: the Decision form's question (spec delta 37)
  mobile: ['mobile', 'mobile number'],
  parent: ['youth parent phone', 'youth parent phone number'],
  submitted: ['date submitted', 'submitted'],
} as const;
type Field = keyof typeof ALIASES;
type Columns = Partial<Record<Field, number>>;
const FIELDS = Object.keys(ALIASES) as Field[];

/** Header -> field, case-insensitive with spaces collapsed; the first matching column wins. A header starting
 *  "what grade" is the grade (a form question reworded keeps working). */
export function auditColumns(headers: readonly string[]): Columns {
  const at: Columns = {};
  headers.forEach((h, i) => {
    const f = h.toLowerCase().replace(/\s+/g, ' ').trim();
    const k = FIELDS.find((x) => (ALIASES[x] as readonly string[]).includes(f)) ?? (f.startsWith('what grade') ? 'grade' : undefined);
    if (k && at[k] === undefined) at[k] = i;
  });
  return at;
}

// ---- dates: a closed set of rules, never guessed from today
const ymd = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
const dm = (a: string, b: string, y: number, order: 'DMY' | 'MDY') => (order === 'MDY' ? ymd(y, +a, +b) : ymd(y, +b, +a));
/** Rules 1 and 2: YYYY-MM-DD (xlsx), or D/M/YYYY (M/D/YYYY under MDY). A trailing time ("22/10/2026 7:43 PM",
 *  "2026-10-22 19:43", "2026-10-22T19:43:00") is ignored (spec delta 36); the date part still follows the rules. */
export function parseDateCell(v: string, order: 'DMY' | 'MDY'): string | null {
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (iso) return ymd(+iso[1]!, +iso[2]!, +iso[3]!);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T].*)?$/.exec(s);
  return m ? dm(m[1]!, m[2]!, +m[3]!, order) : null;
}
/** Rules 1-3 for a column header: a whole date, an embedded D/M/YYYY, or an Elvanto session header's DD/MM with no
 *  year (the year of exportedAt in site time, minus 1 when the date would fall more than 1 day after exportedAt). */
export function parseDateHeader(h: string, ctx: AuditParseCtx): string | null {
  const whole = parseDateCell(h, ctx.dateOrder);
  if (whole) return whole;
  const full = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(h);
  if (full) return dm(full[1]!, full[2]!, +full[3]!, ctx.dateOrder);
  const m = /(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(h);
  if (!m) return null;
  const exp = brisbaneToday(new Date(ctx.exportedAt), ctx.timeZone), y = Number(exp.slice(0, 4));
  const d = dm(m[1]!, m[2]!, y, ctx.dateOrder);
  return d !== null && d > addDays(exp, 1) ? dm(m[1]!, m[2]!, y - 1, ctx.dateOrder) : d;
}
const DATE_LIKE = /\d{1,4}[/-]\d{1,2}/; // a header that looks like a date but fails the rules -> bad-date-column

// ---- values
const ATTENDED = new Set(['y', 'yes', 'true', '1']);
const cell = (r: readonly string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());
const digits = (v: string) => { const d = v.replace(/\D/g, ''); return d.length >= 6 && d.length <= 15 ? d : null; };
const genderOf = (v: string): 'male' | 'female' | null => {
  const g = v.toLowerCase();
  return g === 'f' || g === 'female' || g === 'girl' ? 'female' : g === 'm' || g === 'male' || g === 'boy' ? 'male' : null;
};
function personOf(r: readonly string[], at: Columns, range: AuditParseCtx['gradeRange']): { person: AuditPerson; outOfRange: boolean } {
  const n = /\d+/.exec(cell(r, at.grade)), g = n ? Number(n[0]) : null;
  const inRange = g !== null && g >= range.min && g <= range.max;
  const mobile = digits(cell(r, at.mobile)), parent = mobile ? null : digits(cell(r, at.parent));
  return { outOfRange: g !== null && !inRange, person: { first: cell(r, at.first), last: cell(r, at.last),
    preferred: cell(r, at.preferred) || null, gender: genderOf(cell(r, at.gender)), grade: inRange ? g : null,
    phone: mobile ?? parent, phoneIsParent: !mobile && parent !== null } };
}
const noteList = (n: [AuditNote['note'], number][]): AuditNote[] => n.filter(([, c]) => c > 0).map(([note, count]) => ({ note, count }));
function dateColumns(headers: readonly string[], skip: ReadonlySet<number | undefined>, ctx: AuditParseCtx) {
  const cols: { i: number; d: string }[] = [];
  let bad = 0;
  headers.forEach((h, i) => {
    if (skip.has(i)) return;
    const d = parseDateHeader(h, ctx);
    if (d) cols.push({ i, d }); else if (DATE_LIKE.test(h)) bad++;
  });
  return { cols, bad };
}

// ---- per source
export function parseSource(source: AuditSource, table: AuditTable, ctx: AuditParseCtx): AuditParseResult {
  if (source === 'group') return parseGroup(table, ctx);
  return source === 'connect' || source === 'decision' ? parseForm(table, ctx) : parseAttendance(table, ctx);
}

/** service, team: name columns + one column per session, a mark where the person came. */
function parseAttendance({ headers, rows }: AuditTable, ctx: AuditParseCtx): AuditParseResult {
  const at = auditColumns(headers);
  if (at.first === undefined) return { shape: true, missing: 'First Name' };
  if (at.last === undefined) return { shape: true, missing: 'Last Name' };
  const { cols, bad } = dateColumns(headers, new Set(Object.values(at)), ctx);
  if (!cols.length) return { shape: true, missing: 'a session date column' };
  const out: AuditRow[] = [], skipped: AuditSkip[] = [];
  let outOfRange = 0;
  for (const r of rows) {
    const first = cell(r, at.first), last = cell(r, at.last);
    if (!first || !last) { skipped.push({ reason: 'no-name', name: first || last || null }); continue; }
    const p = personOf(r, at, ctx.gradeRange);
    if (p.outOfRange) outOfRange++;
    out.push({ person: p.person, dates: [...new Set(cols.filter((c) => ATTENDED.has(cell(r, c.i).toLowerCase())).map((c) => c.d))] });
  }
  return { shape: false, rows: out, skipped, notes: noteList([['no-gender-column', at.gender === undefined ? out.length : 0],
    ['bad-date-column', bad], ['grade-out-of-range', outOfRange]]) };
}

/** group: column 0 is the name; a row with no marks is a group header; members are "Last, First"; '-' = not a member. */
function parseGroup({ headers, rows }: AuditTable, ctx: AuditParseCtx): AuditParseResult {
  const { cols, bad } = dateColumns(headers, new Set([0]), ctx);
  if (!cols.length) return { shape: true, missing: 'a meeting date column' };
  const out: AuditRow[] = [], skipped: AuditSkip[] = [];
  let group: string | null = null, sawHeader = false, sawMember = false;
  for (const r of rows) {
    const name = cell(r, 0);
    if (!name) continue;
    if (cols.every((c) => !cell(r, c.i))) { group = name; sawHeader = true; continue; }
    if (group === null) continue;
    sawMember = true;
    if (ctx.leaderTag?.test(name)) continue; // group leaders: excluded on purpose, not reported
    const ci = name.indexOf(','), sp = name.lastIndexOf(' ');
    const last = ci >= 0 ? name.slice(0, ci).trim() : name.slice(sp + 1);
    const first = ci >= 0 ? name.slice(ci + 1).trim() : sp > 0 ? name.slice(0, sp).trim() : '';
    if (!first || !last) { skipped.push({ reason: 'no-name', name }); continue; }
    const mark = (i: number) => cell(r, i).toLowerCase();
    const marked = cols.filter((c) => mark(c.i) !== '' && mark(c.i) !== '-').map((c) => c.d);
    if (!marked.length) continue; // not a member in this export's range
    out.push({ person: { first, last, preferred: null, gender: null, grade: null, phone: null, phoneIsParent: false },
      group, dates: cols.filter((c) => ATTENDED.has(mark(c.i))).map((c) => c.d), marked });
  }
  if (!sawHeader) return { shape: true, missing: 'a group header row' };
  if (!sawMember) return { shape: true, missing: 'member rows' };
  return { shape: false, rows: out, skipped, notes: noteList([['bad-date-column', bad]]) };
}

/** connect, decision: one row per submission (allowlisted columns only, AUDIT_FORM_HEADERS). */
function parseForm({ headers, rows }: AuditTable, ctx: AuditParseCtx): AuditParseResult {
  const at = auditColumns(headers);
  if (at.first === undefined) return { shape: true, missing: 'First Name' };
  if (at.last === undefined) return { shape: true, missing: 'Last Name' };
  if (at.submitted === undefined) return { shape: true, missing: 'Date Submitted' };
  const out: AuditRow[] = [], skipped: AuditSkip[] = [];
  let outOfRange = 0;
  for (const r of rows) {
    const first = cell(r, at.first), last = cell(r, at.last);
    if (!first || !last) { skipped.push({ reason: 'no-name', name: first || last || null }); continue; }
    const submitted = parseDateCell(cell(r, at.submitted), ctx.dateOrder);
    if (!submitted) { skipped.push({ reason: 'bad-date', name: `${first} ${last}` }); continue; }
    const p = personOf(r, at, ctx.gradeRange);
    if (p.outOfRange) outOfRange++;
    out.push({ person: p.person, dates: [], submitted });
  }
  return { shape: false, rows: out, skipped, notes: noteList([['no-gender-column', at.gender === undefined ? out.length : 0],
    ['grade-out-of-range', outOfRange]]) };
}
