// Connection Audit build (spec ys-connection/2026-10-22-connection-audit §5.3-§5.5). Pure: no I/O, `now` injected.
// It builds from the STORED tables (parseSource runs here), so a parser fix re-applies on the next build, no re-feed.
import { computeQuad, type Quad } from '../core/types/enums';
import type { AppSettings } from '../core/entities/settings';
import type { LinkRosterRow } from '../core/link-types';
import type { AuditQuality, AuditSnapshotV2, AuditSource, AuditStudent, AuditTermSnapshot, SourceMeta, StoredAuditSource } from '../core/entities/connection-audit';
import { leaderTagRe, parseSource, type AuditParseCtx, type AuditPerson, type AuditRow } from './audit-parse';
import { buildGroupModel, buildServiceModel, type GroupInput } from './attendance-build';
import { computeYearAggregates } from './year-aggregates';
import { addDays, brisbaneToday, matchFold } from './link-rules';

export type AuditRosterPerson = Pick<LinkRosterRow, 'personId' | 'firstName' | 'lastName' | 'grade' | 'gender' | 'active'>;
export type AuditBuildConfig = Omit<AuditParseCtx, 'exportedAt'> & { serviceDayOfWeek: number; termGapDays: number; serviceMinAttendance: number };

/** The build config from the real settings fields (Y8 calls this). */
export function auditConfigOf(s: AppSettings): AuditBuildConfig {
  const c = s.ministryConfig;
  return { timeZone: c.structure.timeZone, dateOrder: c.import.dateOrder, leaderTag: leaderTagRe(c.import.leaderTag || 'leader'),
    gradeRange: { min: c.structure.gradeMin, max: c.structure.gradeMax }, serviceDayOfWeek: c.structure.serviceDayOfWeek,
    termGapDays: s.termGapDays, serviceMinAttendance: s.serviceMinAttendance };
}

const MIN_TERM_SESSIONS = 3; // §5.3.3: a run of fewer valid sessions is a holiday one-off, not a term
const keyOf = (first: string, last: string) => `${matchFold(first)}|${matchFold(last)}`; // contract X8 (link-rules.ts:305)
const quadOf = (grade: number | null, gender: 'male' | 'female' | null): Quad | null => (gender ? computeQuad(grade, gender) : null);
// grade/gender come from the first source in this order that has them; the roster is the fallback (§5.3.5)
const ORDER: AuditSource[] = ['service', 'team', 'connect', 'decision', 'group'];

interface Person { id: string; personId: string | null; ambiguous: boolean; p: AuditPerson; sources: Set<AuditSource>; keys: Set<string>;
  svc: Set<string>; grp: Set<string>; team: boolean; connects: string[]; decisions: string[]; phone: string | null; phoneIsParent: boolean }
type Fed = { source: AuditSource; row: AuditRow };

/** Parse every good stored copy of the year and clip each fact to the calendar year (silently, §5.5). */
function parseAll(year: number, sources: StoredAuditSource[], cfg: AuditBuildConfig): Fed[] {
  const from = `${year}-01-01`, to = `${year}-12-31`, inYear = (d: string) => d >= from && d <= to;
  const fed: Fed[] = [];
  for (const s of sources) {
    if (s.year !== year || s.fedAt === null) continue; // never had a good copy: contributes nothing (§8)
    const r = parseSource(s.source, { headers: s.headers, rows: s.rows }, { ...cfg, exportedAt: s.exportedAt });
    if (r.shape) continue; // a stored copy the parser can no longer read contributes nothing; the build never throws
    for (const row of r.rows) {
      if (row.submitted !== undefined && !inYear(row.submitted)) continue;
      const dates = row.dates.filter(inYear), marked = row.marked?.filter(inYear);
      if (row.submitted === undefined && !dates.length) continue; // no fact in this year
      fed.push({ source: s.source, row: { ...row, dates, ...(marked ? { marked } : {}) } });
    }
  }
  return fed.sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source)); // stable: keeps row order per source
}

/** §5.3.5: one id per person. Roster key first|last, else preferred|last; one hit = personId; 2+ = ambiguous; 0 = n:key. */
function identify(fed: Fed[], roster: AuditRosterPerson[], range: AuditBuildConfig['gradeRange']) {
  const byKey = new Map<string, AuditRosterPerson[]>();
  for (const r of roster) if (r.active) { const k = keyOf(r.firstName, r.lastName); byKey.set(k, [...(byKey.get(k) ?? []), r]); }
  const people = new Map<string, Person>(), hitOf = new Map<string, AuditRosterPerson>();
  const ids = fed.map(({ source, row }) => {
    const p = row.person, k1 = keyOf(p.first, p.last), k2 = p.preferred ? keyOf(p.preferred, p.last) : null;
    const hits = byKey.get(k1) ?? (k2 ? byKey.get(k2) : undefined) ?? [];
    const id = hits.length === 1 ? hits[0]!.personId : `n:${k1}`;
    let x = people.get(id);
    if (!x) {
      x = { id, personId: hits.length === 1 ? id : null, ambiguous: hits.length > 1, p: { ...p }, sources: new Set(), keys: new Set(),
        svc: new Set(), grp: new Set(), team: false, connects: [], decisions: [], phone: null, phoneIsParent: false };
      people.set(id, x);
      if (hits.length === 1) hitOf.set(id, hits[0]!);
    }
    x.sources.add(source);
    x.keys.add(k1);
    if (k2) x.keys.add(k2);
    if (x.p.grade === null) x.p.grade = p.grade;
    if (x.p.gender === null) x.p.gender = p.gender;
    if (x.p.preferred === null) x.p.preferred = p.preferred;
    return id;
  });
  for (const [id, r] of hitOf) {
    const x = people.get(id)!;
    if (x.p.grade === null && r.grade !== null && r.grade >= range.min && r.grade <= range.max) x.p.grade = r.grade;
    if (x.p.gender === null) x.p.gender = r.gender;
  }
  return { people, ids };
}

/** Rebuild GroupInput (one per lifegroup) from the parsed group rows, so buildGroupModel / buildLifegroupStats are reused. */
function groupInputs(fed: Fed[], ids: string[]): GroupInput[] {
  const by = new Map<string, { meetings: Set<string>; members: { id: string; p: AuditPerson; went: Set<string>; marked: Set<string> }[] }>();
  fed.forEach((f, i) => {
    if (f.source !== 'group' || !f.row.group) return;
    const g = by.get(f.row.group) ?? { meetings: new Set<string>(), members: [] };
    by.set(f.row.group, g);
    const marked = new Set(f.row.marked ?? f.row.dates);
    marked.forEach((d) => g.meetings.add(d));
    g.members.push({ id: ids[i]!, p: f.row.person, went: new Set(f.row.dates), marked });
  });
  return [...by].map(([name, g]) => {
    const meetings = [...g.meetings].sort();
    return { name, meetings, members: g.members.map((m) => ({ id: m.id, first_name: m.p.first, last_name: m.p.last,
      attendance: meetings.map((d) => (m.went.has(d) ? true : m.marked.has(d) ? false : null)) })) };
  });
}

function unmatched(people: Person[]): AuditQuality['unmatched'] {
  return people.filter((x) => !x.personId).slice(0, 500).map((x) => ({ id: x.id, name: `${x.p.preferred || x.p.first} ${x.p.last}`,
    sources: ORDER.filter((s) => x.sources.has(s)), grade: x.p.grade, ambiguous: x.ambiguous }));
}

/** §5.3.6: flagged pairs, never merged. */
function duplicates(people: Person[]): AuditQuality['duplicates'] {
  const out: AuditQuality['duplicates'] = [];
  const byLast = new Map<string, Person[]>();
  for (const x of people) { const k = matchFold(x.p.last); byLast.set(k, [...(byLast.get(k) ?? []), x]); }
  // ponytail: O(n²) within one surname; a surname has a handful of people
  for (const g of byLast.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const a = g[i]!, b = g[j]!, fa = matchFold(a.p.first), fb = matchFold(b.p.first);
    const [s, l] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
    if (s !== l && s.length >= 3 && l.startsWith(s) && (a.p.grade === null || b.p.grade === null || a.p.grade === b.p.grade))
      out.push({ a: a.id, b: b.id, why: 'short-name' });
  }
  const loose = new Map(people.filter((x) => !x.personId).map((x) => [x.id.slice(2), x]));
  for (const x of people) if (x.personId) for (const k of x.keys) {
    const u = loose.get(k);
    if (u) out.push({ a: x.id, b: u.id, why: 'matched-and-unmatched' });
  }
  return out.slice(0, 200);
}

export function buildYear(year: number, sources: StoredAuditSource[], roster: AuditRosterPerson[], cfg: AuditBuildConfig, now: Date): AuditSnapshotV2 {
  const fed = parseAll(year, sources, cfg);
  const { people, ids } = identify(fed, roster, cfg.gradeRange);
  const svc = buildServiceModel(fed.flatMap((f, i) => (f.source === 'service' ? [{ id: ids[i]!, dates: f.row.dates }] : [])), cfg.serviceMinAttendance);
  const groups = groupInputs(fed, ids);
  const grp = buildGroupModel(groups, cfg.serviceDayOfWeek);
  const agg = computeYearAggregates({
    termGapDays: cfg.termGapDays, serviceDayOfWeek: cfg.serviceDayOfWeek,
    serviceSessions: svc.sessions.map((s) => ({ id: s.id, date: s.sessionDate, valid: s.isValid })),
    serviceAttendance: svc.attendance.map((a) => ({ studentId: a.id, sessionId: a.sessionId, attended: true })),
    weekStartById: new Map(grp.weeks.map((w) => [w.id, w.weekStart])),
    lifegroupAttendance: grp.attendance.map((a) => ({ studentId: a.id, weekId: a.weekId, attended: a.attended })),
  }, { minRun: MIN_TERM_SESSIONS, year });

  const valid = svc.sessions.filter((s) => s.isValid).map((s) => s.sessionDate);
  const dataStartDate = valid[0] ?? null, dataEndDate = valid.at(-1) ?? null;
  // §5.3.4: only the latest term, only this site-year, only within termGapDays of the last valid session
  const today = brisbaneToday(now, cfg.timeZone);
  const open = dataEndDate !== null && today.startsWith(`${year}-`) && today <= addDays(dataEndDate, cfg.termGapDays);
  const latest = agg.terms.at(-1)?.key;
  const perTerm: Record<string, AuditTermSnapshot> = {};
  for (const [key, t] of agg.perTerm) {
    const byStudent: AuditTermSnapshot['byStudent'] = {};
    for (const [id, a] of t.byStudent) byStudent[id] = { svcAttended: a.svcAttended, grpAttended: a.grpAttended, grpTotal: a.grpTotal };
    perTerm[key] = { key, svcTotal: t.svcTotal, inProgress: open && key === latest, byStudent };
  }

  const all = [...people.values()];
  const students: AuditStudent[] = all.map((x): AuditStudent => ({
    id: x.id, personId: x.personId, firstName: x.p.preferred || x.p.first, lastName: x.p.last,
    gender: x.p.gender ?? 'other', grade: x.p.grade, quad: quadOf(x.p.grade, x.p.gender),
    caOnly: !x.sources.has('service') && !x.sources.has('group'),
    team: false, connect: null, decision: null, lastSeen: null, phone: null, phoneIsParent: false, // facts: Y5b
  })).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));

  return {
    version: 2, generatedAt: now.toISOString(), dataStartDate, dataEndDate, terms: agg.terms, students, perTerm,
    lgStatsByTerm: {}, weekly: [],                                                          // Y5b
    followUp: { drifting: [], decidedNoGroup: [], connectedNeverCame: [] }, signals: { quadDrop: null }, // Y5c
    sources: {} as Record<AuditSource, SourceMeta>,                                          // Y5c
    quality: { skipped: [], notes: [], unmatched: unmatched(all), duplicates: duplicates(all) },
  };
}
