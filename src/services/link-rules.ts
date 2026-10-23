// Pure rules for the Elvanto link (spec 2026-10-12-elvanto-link-app-design.md §5.1, §5.2). No I/O and no clock:
// the caller passes `now` / `today`.
import type {
  ActionType, IgnoredWhy, LinkRosterRow, LinkServiceRow, Match, OutboxRow, ResultItem, Status,
} from '../core/link-types';
import { NOTE_FAILED_DETAIL, isDnc } from '../core/link-contract';

export const LINK_CUTOFF_DAYS = 3;
export const LEASE_LOST_MS = 3_600_000;

// ---------------- Time (the location's time zone, structure.timeZone; Brisbane = UTC+10, no DST) ----------------

const DAY_MS = 86_400_000;

/** The location's time facts (ministryConfig.structure): pass the structure itself. */
export interface SiteTime { timeZone: string; serviceDayOfWeek: number; consentCutoff: string }

const FMT = new Map<string, Intl.DateTimeFormat>();
/** The wall clock of an instant in `tz`: { ymd, hhmm }. One cached formatter per tz. */
function wall(ms: number, tz: string): { ymd: string; hhmm: string } {
  if (!tz) throw new Error('time zone required');
  let f = FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    FMT.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}
/** `tz`'s UTC offset at an instant, in ms. */
const offsetAt = (ms: number, tz: string) => { const w = wall(ms, tz); return Date.parse(`${w.ymd}T${w.hhmm}:00Z`) - (ms - (((ms % 60_000) + 60_000) % 60_000)); };

/** The instant of a wall-clock time `hhmm` on `ymd` in `tz`. In a daylight-saving gap: the instant after the gap
 *  (02:30 -> 03:30 new time). In a repeated hour: the first one. Same rule as the console's zoned.instantOf (C4a). */
export function instantOf(ymd: string, hhmm: string, tz: string): number {
  const g = Date.parse(`${ymd}T${hhmm}:00Z`);
  const before = offsetAt(g - DAY_MS, tz), after = offsetAt(g + DAY_MS, tz);
  for (const o of before >= after ? [before, after] : [after, before]) { // the larger offset is the earlier instant
    const w = wall(g - o, tz);
    if (w.ymd === ymd && w.hhmm === hhmm) return g - o;
  }
  return g - before; // the gap
}

/** Today's date in the location's time zone (YYYY-MM-DD). Brisbane: the day flips at 14:00Z. */
export function brisbaneToday(now: Date, tz: string): string {
  return wall(now.getTime(), tz).ymd;
}

/** The service day (D3): the local day, or the previous day before 03:00 local (check-outs after midnight on a Friday). */
export function serviceDay(now: Date, tz: string): string {
  const w = wall(now.getTime(), tz);
  return w.hhmm < '03:00' ? addDays(w.ymd, -1) : w.ymd;
}

export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

/** The local wall-clock time of an instant, "HH:MM". */
export function brisbaneHHMM(iso: string, tz: string): string {
  return wall(Date.parse(iso), tz).hhmm;
}

// ---------------- Which service (spec §2.3) ----------------

/** Mirror services with ymd in today−7 … today, newest first. */
export function pickList(services: LinkServiceRow[], today: string): LinkServiceRow[] {
  const from = addDays(today, -7);
  return services
    .filter((s) => s.ymd >= from && s.ymd <= today)
    .sort((a, b) => (a.ymd === b.ymd ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : a.ymd < b.ymd ? 1 : -1));
}

/** The youth night (structure.serviceDayOfWeek; Brisbane Friday): the day's only service. Sunday (N12): the day's only
 *  service, else the one whose local time of day is nearest `now` (10:15 without `now`). Otherwise none. */
export function defaultService(day: string, services: LinkServiceRow[], now: Date | undefined,
  s: Pick<SiteTime, 'timeZone' | 'serviceDayOfWeek'>): LinkServiceRow | null {
  const wd = weekdayOf(day);
  const candidates = services.filter((s) => s.ymd === day);
  if (wd === 0 && candidates.length > 1) {
    const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const at = mins(now ? brisbaneHHMM(now.toISOString(), s.timeZone) : '10:15');
    const gap = (x: LinkServiceRow) => Math.abs(mins(brisbaneHHMM(x.startsAt, s.timeZone)) - at);
    return candidates.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  }
  if (wd !== 0 && wd !== s.serviceDayOfWeek) return null;
  return candidates.length === 1 ? candidates[0]! : null;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** A full day name (or its plural) or the exact 3-letter form (T-49): "Monthly" and "Sunset" are not days. */
const DAY_RE = /\b(?:(sun|mon|tue|wed|thu|fri|sat)|(sun|mon|tues|wednes|thurs|fri|satur)days?)\b/;
const LONG = ['sun', 'mon', 'tues', 'wednes', 'thurs', 'fri', 'satur'];

/** Weekday named in `meets`, 0=Sun..6=Sat, or -1 (same T-49 rule: "Tues" alone is not a day). */
export function meetsWeekday(meets: string): number {
  const m = meets.toLowerCase().match(DAY_RE);
  return !m ? -1 : m[1] ? WEEKDAYS.indexOf(m[1]) : LONG.indexOf(m[2]!);
}

/** The latest date ≤ today on the weekday named in `meets` ("Tue 6:30 PM", "Tuesday"); today if none. */
export function lastMeetingDate(meets: string, today: string): string {
  const target = meetsWeekday(meets);
  if (target < 0) return today;
  const back = (weekdayOf(today) - target + 7) % 7;
  return addDays(today, -back);
}

// ---------------- Dedupe (contract §5.1) ----------------

/**
 * The one name fold (contract X8): Unicode NFKD with the accents removed, curly quotes made straight, lower case, no
 * spaces round a hyphen, runs of spaces made one space, trimmed. A short name still does not match a full name.
 */
export function nameFold(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'").replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .toLowerCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}

export function dedupeKey(type: ActionType, payload: Record<string, unknown>): string {
  const p = payload as Record<string, string>;
  switch (type) {
    case 'checkIn': return `checkIn:${p.serviceTimeId}:${p.personId}`;
    case 'checkOut': return `checkOut:${p.serviceTimeId}:${p.personId}`;
    case 'submitReport':
    case 'editReport': return `report:${p.groupId}:${p.date}`;
    case 'completeStep': return `complete:${p.rowId}`;
    case 'firstTimerCheckIn': return `first:${p.serviceTimeId}:${nameFold(p.firstName ?? '')} ${nameFold(p.lastName ?? '')}`;
    case 'addGroupMember': return `addMember:${p.groupId}:${p.personId}`;
    case 'removeGroupMember': return `removeMember:${p.groupId}:${p.personId}`;
    // X19 (T4): one open row per family / row and kind, per plan date.
    case 'intakeAnswer': return `ia:${p.date}:${(payload.family as string[])[0]}`;
    case 'intakeSave': return `is:${p.date}:${p.row}`;
    case 'consentSave': return `cs:${p.date}:${p.row}`;
    case 'intakeText': return `it:${p.date}:${p.row}`;
    // Rev 6: one open removal / fix per row / person; a lookup is its own request (ref = its id).
    case 'removeFromFlowStep': return `rm:${p.rowId}`;
    case 'consentLookup': return `cl:${p.ref}`;
    case 'consentFix': return `cf:${p.personId}`;
    // Rev 15 (L2): one open link per form AND person (a form may name several children); one open unlink per form.
    case 'consentLink': return p.personId ? `cn:${p.subId}:${p.personId}` : `cn:${p.subId}`;
    case 'busConsentCheck': return 'bcc'; // rev 18: one open bus consent check at a time
    case 'recheck': return `rc:${p.ref}`; // rev 15 (L7): one open re-check per unclear row
  }
}

// ---------------- Group members (T6, contract X18) ----------------

export interface GroupMember { personId: string; name: string; leader: boolean }
/**
 * The group's members as Elvanto has them now: the mirror's list, then every member change the console reported sent
 * after that push (oldest first). `rows` = this group's sent addGroupMember / removeGroupMember rows, any order.
 */
export function effectiveMembers(members: GroupMember[], rows: OutboxRow[], groupsTakenAt: string | null,
  nameOf: (personId: string) => string): GroupMember[] {
  let out = members.slice();
  const after = rows.filter((r) => r.status === 'sent' && r.resultAt
    && (!groupsTakenAt || Date.parse(r.resultAt) > Date.parse(groupsTakenAt)))
    .sort((a, b) => Date.parse(a.resultAt!) - Date.parse(b.resultAt!));
  for (const r of after) {
    const pid = (r.payload as { personId?: string }).personId;
    if (!pid) continue;
    if (r.type === 'removeGroupMember') out = out.filter((m) => m.personId !== pid);
    else if (r.type === 'addGroupMember' && !out.some((m) => m.personId === pid)) out.push({ personId: pid, name: nameOf(pid), leader: false });
  }
  return out;
}

// ---------------- Attribution (contract X1, ledger 25 D2) ----------------

/** The ClaimRow `note` cap (contract §3.2). The prefixed text must fit it. */
export const CLAIM_NOTE_MAX = 1900;
export const ATTRIBUTED_TYPES: readonly ActionType[] = ['submitReport', 'editReport', 'completeStep', 'removeFromFlowStep'];

// ---------------- Rev 6: the New People consent step (review C1) ----------------

// Prefix match like the old rule and the console: a suffix on the Elvanto name must not switch the step-0 gate off.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** E3: this year's New People flow among the pushed flow names: the highest year <= today's site year, else the highest
 *  (January before the new flow exists keeps last year's). Same rule as 11.1 youth-gather.js FLOW.people. null = none.
 *  Y2a: `prefix` = ministryConfig.elvanto.peopleFlowPrefix (Brisbane "Brisbane - Youth - New People"); blank = null. */
export function peopleFlowName(names: Iterable<string>, today: string, prefix: string): string | null {
  if (!prefix.trim()) return null;
  const re = new RegExp('^' + esc(prefix) + ' (\\d{4})\\b', 'i');
  const year = Number(today.slice(0, 4));
  const found = [...new Set(names)].map((n) => [Number(re.exec(n.trim())?.[1]), n] as const)
    .filter(([y]) => y > 0).sort((a, b) => b[0] - a[0] || a[1].length - b[1].length); // same year: the exact (shortest) name first
  return (found.find(([y]) => y <= year) ?? found[0])?.[1] ?? null;
}
/** Step "0" / "Step 0 ..." of any flow (Y2a: every one refuses while the New People flow is unknown). */
export const isStepZero = (stepName: string) => /^(step\s*)?0\b/i.test(stepName.trim());
/** The 7-day consent wait: step "0" / "Step 0 ..." of `peopleFlow` (peopleFlowName; youth-gather.js STEP.people0). */
export const isConsentStep = (r: { flowName: string; stepName: string }, peopleFlow: string | null) =>
  peopleFlow !== null && r.flowName === peopleFlow && isStepZero(r.stepName);
/**
 * R4/R6: the consent Friday a step-0 row waits for: the first youth night (`serviceDayOfWeek`, Brisbane Friday) after its
 * date (a row due Fri 16 Oct is that week's new person, so its consent window closes Fri 23 Oct 9:00 Brisbane). R8 (rev 10):
 * the date is the parent-texted date (`textedOn`, the Consents Other date) when the console sent one, else the due date.
 * null with neither.
 */
export function consentFriday(due: string | null | undefined, textedOn: string | null | undefined, serviceDayOfWeek: number): string | null {
  const d = textedOn && /^\d{4}-\d{2}-\d{2}$/.test(textedOn) ? textedOn : due;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return addDays(d, ((serviceDayOfWeek - weekdayOf(d) + 6) % 7) + 1);
}
/** That night's consent cut-off (structure.consentCutoff, local time; Brisbane 9:00) has passed. */
export const consentFridayPassed = (friday: string, now: Date, cutoff: string, tz: string) => now.getTime() >= instantOf(friday, cutoff, tz);
/**
 * Complete on the consent step (step 0). 'done': that person's consent row (New youth & consent) is done, or
 * their profile consent is 'ok' and no consent row for them is open. 'notReceived' (R4): no consent row at all, no consent
 * on the profile, not DO NOT CONTACT, and their consent Friday 9:00 has passed: allowed, and the console records consent
 * not received first. null: refused (CONSENT_CHECK_FIRST).
 * consentSave (the consent path) never comes here.
 */
export function consentStepAllowed(row: { personId: string | null; consent?: string | null; due?: string | null; textedOn?: string | null },
  consentRows: { key: string; status: string }[], now: Date, s: SiteTime): 'done' | 'notReceived' | null {
  if (!row.personId || isDnc(row.consent)) return null; // CY-B1: DO NOT CONTACT first, even over a done consent row
  const mine = consentRows.filter((r) => r.key === row.personId);
  if (mine.some((r) => r.status === 'done')) return 'done';
  if (mine.length) return null; // an open consent row: the Consents screen saves it
  if (row.consent === 'ok') return 'done';
  const f = consentFriday(row.due, row.textedOn, s.serviceDayOfWeek);
  return f && consentFridayPassed(f, now, s.consentCutoff, s.timeZone) ? 'notReceived' : null;
}
/** Connection Audit (consent audit B): still inside the consent week, so not offered for contact. DNC = decided (the row stays
 *  and reads "Do not contact"). No date to count from (a regular, not a new person) = decided. Matched: Complete on step 0's
 *  own verdict (consentStepAllowed); unmatched: the consent Friday's cut-off has not passed. */
export function consentPending(p: { personId: string | null; consent?: string | null; due?: string | null; textedOn?: string | null },
  rows: { key: string; status: string }[], now: Date, s: SiteTime): boolean {
  if (isDnc(p.consent) || (!p.due && !p.textedOn)) return false;
  if (p.personId) return consentStepAllowed(p, rows, now, s) === null;
  const f = consentFriday(p.due, p.textedOn, s.serviceDayOfWeek);
  return !!f && !consentFridayPassed(f, now, s.consentCutoff, s.timeZone);
}

/** `Self identified leader: <name> — <note>`, or the name alone when the leader wrote no note. */
export function attributedNote(leaderName: string, note: string | null): string {
  const head = `Self identified leader: ${leaderName}`;
  return note ? `${head} — ${note}` : head;
}

const FLOW_NOTE: readonly ActionType[] = ['completeStep', 'removeFromFlowStep'];
/** Flows (2026-10-24, ruling Q2): `<name>: "<note>"`, or the name alone; reports keep attributedNote. */
export function claimNote(type: ActionType, leaderName: string, note: string | null): string {
  if (!FLOW_NOTE.includes(type)) return attributedNote(leaderName, note);
  return note ? `${leaderName}: "${note}"` : leaderName;
}

/** The longest leader note that still fits CLAIM_NOTE_MAX once prefixed. */
export function noteRoom(leaderName: string): number {
  return CLAIM_NOTE_MAX - attributedNote(leaderName, 'x').length + 1;
}

// ---------------- Outbox state machine (contract §3.3 / §5.3) ----------------

const FINAL: Status[] = ['sent', 'refused', 'cancelled', 'unclear'];

function targetStatus(item: ResultItem): Status {
  switch (item.outcome) {
    case 'sent':
    case 'already': return 'sent';
    case 'retry': return 'pending';
    case 'resolved': return item.landed ? 'sent' : 'refused';
    case 'planned': return 'sent';
    default: return item.outcome;
  }
}

export function applyOutcome(row: OutboxRow | null, item: ResultItem, consoleId: string, now: Date):
  { next: Partial<OutboxRow> } | { ignored: IgnoredWhy } {
  if (!row) return { ignored: 'unknown-id' };
  const at = now.toISOString();
  const target = targetStatus(item);

  if (item.outcome === 'resolved') {
    if (row.status === 'unclear') {
      // X5 (B2): resolved clears the unclear row's detail; landed also clears the reason. No ids on resolved.
      return { next: item.landed
        ? { status: 'sent', reason: null, detail: null, resultAt: at, updatedAt: at }
        : { status: 'refused', reason: 'not-landed', detail: null, resultAt: at, updatedAt: at } };
    }
    // An unclear row that was already resolved the same way: idempotent.
    if ((row.status === 'sent' || row.status === 'refused') && row.status === target) return { ignored: 'already-final' };
    return { ignored: 'bad-transition' };
  }

  if (row.status === 'claimed') {
    if (row.leaseOwner !== consoleId) return { ignored: 'not-leased' };
    // X19: an intake chain's steps/stop are kept with the row when the console sends them.
    const chain = 'steps' in item || 'stop' in item
      ? { ...(item.steps ? { steps: item.steps } : {}), ...(item.stop ? { stop: item.stop } : {}) } : {};
    const base = { updatedAt: at, ...chain };
    switch (item.outcome) {
      case 'sent': return { next: { ...base, status: 'sent', reason: null, detail: item.note === 'failed' ? NOTE_FAILED_DETAIL : null, resultAt: at,
        sentLogKey: item.sentLogKey, reportId: item.reportId ?? row.reportId, personId: item.personId ?? row.personId } };
      case 'already': return { next: { ...base, status: 'sent', reason: 'already', detail: null, resultAt: at } };
      case 'planned': return { next: { ...base, status: 'sent', reason: 'planned', detail: null, resultAt: at } };
      case 'refused': return { next: { ...base, status: 'refused', reason: item.reason, detail: item.detail ?? null, resultAt: at } };
      case 'unclear': return { next: { ...base, status: 'unclear', sentLogKey: item.sentLogKey, detail: item.detail ?? null, resultAt: at } };
      case 'retry': return { next: { ...base, status: 'pending', reason: item.reason,
        retryAt: new Date(now.getTime() + item.retrySeconds * 1000).toISOString(), leaseOwner: null, leaseUntil: null } };
    }
  }

  if (FINAL.includes(row.status)) return { ignored: row.status === target ? 'already-final' : 'bad-transition' };
  return { ignored: 'not-leased' }; // pending: nobody holds a lease on it
}

// ---------------- Auto-match (contract §6) ----------------

export interface MatchStudent { id: string; firstName: string; lastName: string; gender: string; grade?: number | null; }
export interface MatchChange { personId: string; studentId: string | null; match: Match; }

/** Matching only (not dedupe): the X8 fold with spaces, hyphens, apostrophes and dots dropped, so "Faux Cook",
 *  "Faux-Cook" and "FauxCook" agree. First and last stay separate; a surname alone never matches. */
export const matchFold = (s: string) => nameFold(s).replace(/[\s'.-]/g, '');
const nameKey = (first: string, last: string) => `${matchFold(first)}|${matchFold(last)}`;
/** Gender only blocks a match when both sides say male/female and differ; blank, null or YS 'other' is unknown. */
export const genderFits = (a: string | null | undefined, b: string | null | undefined) => {
  const k = (g: string | null | undefined) => (g === 'male' || g === 'female' ? g : null);
  return !k(a) || !k(b) || k(a) === k(b);
};

/**
 * Operator 2026-10-14: a matched pair (auto or manual, after `changes`) whose folded first + last name and grade agree
 * takes Elvanto's gender, only when Elvanto says male/female and the YS student differs. Nothing to write = empty.
 */
export function genderFixes<S extends MatchStudent>(roster: LinkRosterRow[], students: S[], changes: MatchChange[] = []):
  { student: S; gender: 'male' | 'female' }[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  const now = new Map(changes.map((c) => [c.personId, c]));
  return roster.flatMap((r) => {
    const { studentId, match } = now.get(r.personId) ?? r;
    const s = studentId && (match === 'auto' || match === 'manual') ? byId.get(studentId) : undefined;
    if (!s || !r.active || (r.gender !== 'male' && r.gender !== 'female') || s.gender === r.gender) return [];
    return r.grade != null && r.grade === s.grade && nameKey(r.firstName, r.lastName) === nameKey(s.firstName, s.lastName)
      ? [{ student: s, gender: r.gender }] : [];
  });
}

/**
 * The changes to write after a roster push. Resets a dead studentId to none and releases an `auto` row that is no
 * longer an active student (APP-11), then matches `none` (and re-checks `ambiguous`) active student rows by the
 * import's name key (matchFold) with a gender that fits (genderFits); grade breaks a tie. Inactive rows do not count towards a same-name clash. Never changes a live
 * manual/ignored row, or an auto row that is still an active student.
 */
export function autoMatch(roster: LinkRosterRow[], students: MatchStudent[]): MatchChange[] {
  const studentIds = new Set(students.map((s) => s.id));
  const byKey = new Map<string, MatchStudent[]>();
  for (const s of students) {
    const k = nameKey(s.firstName, s.lastName);
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const eligible = (r: LinkRosterRow) => r.active && r.kind === 'student';
  const rosterKeyCount = new Map<string, number>();
  const rosterKeyGrade = new Map<string, number>(); // same name AND same grade (the grade tie-break needs it unique)
  for (const r of roster) {
    if (!r.active) continue;
    const k = nameKey(r.firstName, r.lastName);
    rosterKeyCount.set(k, (rosterKeyCount.get(k) ?? 0) + 1);
    rosterKeyGrade.set(`${k}|${r.grade}`, (rosterKeyGrade.get(`${k}|${r.grade}`) ?? 0) + 1);
  }
  const state = roster.map((r) => {
    let studentId = r.studentId;
    let match = r.match;
    if (studentId && !studentIds.has(studentId)) { studentId = null; match = 'none'; }
    if (!eligible(r) && (match === 'auto' || match === 'ambiguous')) { studentId = null; match = 'none'; }
    return { r, studentId, match };
  });
  // Students another row still points at (the unique index allows one person per student).
  const taken = new Set(state.filter((x) => x.studentId).map((x) => x.studentId!));

  const changes: MatchChange[] = [];
  for (const x of state) {
    const r = x.r;
    let { studentId, match } = x;
    if (eligible(r) && (match === 'none' || match === 'ambiguous')) {
      const k = nameKey(r.firstName, r.lastName);
      const fits = (byKey.get(k) ?? []).filter((s) => genderFits(r.gender, s.gender));
      const hits = fits.filter((s) => !taken.has(s.id));
      // B16: grade breaks an ambiguous tie only when exactly one candidate's grade matches (and no other roster row
      // has the same name and grade).
      const sameGrade = fits.filter((s) => r.grade != null && s.grade === r.grade);
      const tie = (rosterKeyCount.get(k) ?? 0) > 1 ? hits.length > 0 : hits.length > 1;
      if (tie && sameGrade.length === 1 && !taken.has(sameGrade[0]!.id) && rosterKeyGrade.get(`${k}|${r.grade}`) === 1) {
        studentId = sameGrade[0]!.id; match = 'auto'; taken.add(studentId);
      } else if (tie) { studentId = null; match = 'ambiguous'; }
      else if (hits.length === 1) { studentId = hits[0]!.id; match = 'auto'; taken.add(studentId); }
      else { studentId = null; match = 'none'; }
    }
    if (studentId !== r.studentId || match !== r.match) changes.push({ personId: r.personId, studentId, match });
  }
  return changes;
}

// ---------------- Effective check state (spec §5.2) ----------------

export interface CheckState { in: boolean }

/** X11 (T-21): a sent row still decides for this long after the mirror's takenAt (the two clocks can disagree). */
export const SENT_GRACE_MS = 120_000;

/** One person and one service. `rows` = their checkIn/checkOut rows, newest first. */
export function effectiveCheckState(a: { mirrorIn: boolean; mirrorTakenAt: string | null; rows: OutboxRow[] }): CheckState {
  const newest = a.rows.find((r) => r.status !== 'cancelled' && r.status !== 'refused') ?? null;
  if (newest) {
    const s = newest.status;
    const decides = s === 'pending' || s === 'claimed' || s === 'unclear'
      || (s === 'sent' && (a.mirrorTakenAt == null
        || (newest.resultAt != null && Date.parse(newest.resultAt) + SENT_GRACE_MS > Date.parse(a.mirrorTakenAt))));
    if (decides) return { in: newest.type === 'checkIn' };
  }
  return { in: a.mirrorIn };
}
