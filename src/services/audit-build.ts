// Connection Audit build (spec ys-connection/2026-10-22-connection-audit §5.3-§5.5). Pure: no I/O, `now` injected.
// It builds from the STORED tables (parseSource runs here), so a parser fix re-applies on the next build, no re-feed.
import { QUADS, computeQuad, type Quad } from '../core/types/enums';
import type { AppSettings } from '../core/entities/settings';
import type { LinkRosterRow } from '../core/link-types';
import type { AuditQuality, AuditSnapshotV2, AuditSource, AuditStudent, AuditTermSnapshot, AuditWeek, AuditWeekCounts, SourceMeta, StoredAuditSource } from '../core/entities/connection-audit';
import { leaderTagRe, parseSource, type AuditParseCtx, type AuditPerson, type AuditRow } from './audit-parse';
import { buildGroupModel, buildLifegroupStats, buildServiceModel, parseGroupMeta, type GroupInput, type ServiceParsed } from './attendance-build';
import { saturdayOf } from './terms';
import { computeYearAggregates } from './year-aggregates';
import { addDays, brisbaneToday, matchFold } from './link-rules';
import { AUDIT_SOURCES } from '../core/link-contract';
import type { LabeledTerm } from './year-terms';

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
function parseAll(year: number, sources: StoredAuditSource[], cfg: AuditBuildConfig): { fed: Fed[]; skipped: AuditQuality['skipped']; notes: AuditQuality['notes'] } {
  const from = `${year}-01-01`, to = `${year}-12-31`, inYear = (d: string) => d >= from && d <= to;
  const fed: Fed[] = [];
  const skipped = new Map<string, AuditQuality['skipped'][number]>(), notes = new Map<string, AuditQuality['notes'][number]>();
  for (const s of sources) {
    if (s.year !== year || s.fedAt === null) continue; // never had a good copy: contributes nothing (§8)
    const r = parseSource(s.source, { headers: s.headers, rows: s.rows }, { ...cfg, exportedAt: s.exportedAt });
    if (r.shape) continue; // a stored copy the parser can no longer read contributes nothing; the build never throws
    for (const k of r.skipped) {
      const key = `${s.source}|${k.reason}|${k.name ?? ''}`, g = skipped.get(key) ?? { source: s.source, reason: k.reason, name: k.name, count: 0 };
      g.count++; skipped.set(key, g);
    }
    for (const n of r.notes) {
      const key = `${s.source}|${n.note}`, g = notes.get(key) ?? { source: s.source, note: n.note, count: 0 };
      g.count += n.count; notes.set(key, g);
    }
    for (const row of r.rows) {
      if (row.submitted !== undefined && !inYear(row.submitted)) continue;
      const dates = row.dates.filter(inYear), marked = row.marked?.filter(inYear);
      if (row.submitted === undefined && !dates.length) continue; // no fact in this year
      fed.push({ source: s.source, row: { ...row, dates, ...(marked ? { marked } : {}) } });
    }
  }
  return { fed: fed.sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source)), skipped: [...skipped.values()].slice(0, 500), notes: [...notes.values()] };
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
    if (source === 'service') {
      row.dates.forEach((d) => x!.svc.add(d));
      if (x.phone === null && p.phone !== null) { x.phone = p.phone; x.phoneIsParent = p.phoneIsParent; } // bug 5: service only
    }
    if (source === 'group') row.dates.forEach((d) => x!.grp.add(d));
    if (source === 'team') x.team = true;           // parseAll kept only rows with an in-year date
    if (source === 'connect') x.connects.push(row.submitted!);
    if (source === 'decision') x.decisions.push(row.submitted!);
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

const NONE = 'none' as const;
export const weekEndOf = (d: string, serviceDayOfWeek: number) => addDays(saturdayOf(d, serviceDayOfWeek), 6);
const zero = (night: boolean): AuditWeekCounts => ({ youth: night ? 0 : null, lifegroup: 0, lgGroups: 0, connects: 0, decisions: 0 });

/** §5.3.9: every week of the year up to the latest data week; youth null = no valid session that week (holidays). */
function weeklySeries(year: number, students: AuditStudent[], people: Map<string, Person>, svc: ServiceParsed, groups: GroupInput[], sdow: number): AuditWeek[] {
  const quad = new Map(students.map((s) => [s.id, s.quad ?? NONE]));
  type Acc = { night: boolean; youth: Set<string>; lg: Set<string>; rolls: Map<string, Quad | typeof NONE>; con: Set<string>; dec: Set<string> };
  const weeks = new Map<string, Acc>();
  const at = (d: string): Acc => {
    const k = weekEndOf(d, sdow);
    let a = weeks.get(k);
    if (!a) { a = { night: false, youth: new Set(), lg: new Set(), rolls: new Map(), con: new Set(), dec: new Set() }; weeks.set(k, a); }
    return a;
  };
  const valid = new Set(svc.sessions.filter((s) => s.isValid).map((s) => s.id));
  valid.forEach((d) => { at(d).night = true; });
  for (const a of svc.attendance) if (valid.has(a.sessionId)) at(a.sessionId).youth.add(a.id);
  for (const g of groups) {
    const meta = parseGroupMeta(g.name), gq = quadOf(meta.grade, meta.gender) ?? NONE;
    for (const m of g.members) m.attendance.forEach((mark, i) => {
      if (mark === null) return;
      const w = at(g.meetings[i]!);
      w.rolls.set(g.name, gq);
      if (mark) w.lg.add(m.id);
    });
  }
  for (const x of people.values()) { x.connects.forEach((d) => at(d).con.add(x.id)); x.decisions.forEach((d) => at(d).dec.add(x.id)); }
  if (!weeks.size) return [];
  const last = [...weeks.keys()].sort().at(-1)!, out: AuditWeek[] = [];
  for (let k = weekEndOf(`${year}-01-01`, sdow); k <= last; k = addDays(k, 7)) {
    const a = weeks.get(k), night = !!a?.night;
    const tot = zero(night), byQuad = Object.fromEntries([...QUADS, NONE].map((q) => [q, zero(night)])) as AuditWeek['byQuad'];
    const bump = (ids: Set<string>, f: 'youth' | 'lifegroup' | 'connects' | 'decisions') => ids.forEach((id) => {
      const b = byQuad[quad.get(id) ?? NONE];
      b[f] = (b[f] ?? 0) + 1;
      tot[f] = (tot[f] ?? 0) + 1;
    });
    if (a) {
      if (night) bump(a.youth, 'youth');
      bump(a.lg, 'lifegroup'); bump(a.con, 'connects'); bump(a.dec, 'decisions');
      a.rolls.forEach((q) => { byQuad[q].lgGroups++; tot.lgGroups++; });
    }
    out.push({ weekEnd: k, ...tot, byQuad });
  }
  return out;
}

/** §5.3.10: ids into students; "now" is the latest data week. */
function followUp(students: AuditStudent[], people: Map<string, Person>, weekly: AuditWeek[], sdow: number): AuditSnapshotV2['followUp'] {
  const out: AuditSnapshotV2['followUp'] = { drifting: [], decidedNoGroup: [], connectedNeverCame: [] };
  const now = weekly.at(-1)?.weekEnd;
  if (!now) return out;
  const recentFrom = addDays(now, -21), priorFrom = addDays(now, -77), priorTo = addDays(now, -28); // last 4 | the 8 before
  for (const s of students) {
    const x = people.get(s.id)!, seen = [...x.svc, ...x.grp].map((d) => weekEndOf(d, sdow));
    if (!s.caOnly && seen.filter((w) => w >= priorFrom && w <= priorTo).length >= 3 && !seen.some((w) => w >= recentFrom)) out.drifting.push(s.id);
    if (s.decision && ![...x.grp].some((d) => d >= s.decision!)) out.decidedNoGroup.push(s.id);
    if (s.connect && ![...x.svc].some((d) => d >= s.connect!)) out.connectedNeverCame.push(s.id);
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** §5.3.11: per quad, the last 4 youth nights against the current term's other youth nights; >= 25% fall from >= 8,
 *  and the same holds as of the previous youth night (2 weeks running). The largest fall wins. No-quad never flags. */
function quadDrop(weekly: AuditWeek[], terms: LabeledTerm[]): AuditSnapshotV2['signals']['quadDrop'] {
  const nights = weekly.filter((w) => w.youth !== null);
  const termOf = (w: AuditWeek) => { const s = addDays(w.weekEnd, -6); return terms.find((t) => s >= t.startDate && s <= t.endDate)?.key ?? null; };
  const asOf = (q: Quad, k: number) => {
    if (k < 3) return null;
    const recent = nights.slice(k - 3, k + 1), term = termOf(nights[k]!);
    const others = nights.slice(0, k - 3).filter((w) => termOf(w) === term);
    if (!others.length) return null;
    const avg = (ws: AuditWeek[]) => ws.reduce((n, w) => n + (w.byQuad[q].youth ?? 0), 0) / ws.length;
    const recentAvg = avg(recent), termAvg = avg(others), fall = (termAvg - recentAvg) / termAvg;
    return termAvg >= 8 && fall >= 0.25 ? { quad: q, recentAvg: r1(recentAvg), termAvg: r1(termAvg), dropPct: Math.round(fall * 100) } : null;
  };
  let best: AuditSnapshotV2['signals']['quadDrop'] = null;
  for (const q of QUADS) {
    const cur = asOf(q, nights.length - 1);
    if (cur && asOf(q, nights.length - 2) && (!best || cur.dropPct > best.dropPct)) best = cur;
  }
  return best;
}

/** §9: missing when never good (or no row), failed when the last failure is newer than the good copy, else ok.
 *  Exported: Y8's get(year) uses it for a year that has source copies but no year row yet (spec §6.1 empty state). */
export function sourcesMeta(sources: StoredAuditSource[], year: number): Record<AuditSource, SourceMeta> {
  return Object.fromEntries(AUDIT_SOURCES.map((src): [AuditSource, SourceMeta] => {
    const s = sources.find((x) => x.year === year && x.source === src);
    if (!s) return [src, { status: 'missing', fedBy: null, fedAt: null, exportedAt: null, rows: 0, lastFailedAt: null, lastFailReason: null }];
    const good = s.fedAt !== null;
    const status = !good ? 'missing' : s.lastFailedAt !== null && Date.parse(s.lastFailedAt) > Date.parse(s.fedAt!) ? 'failed' : 'ok';
    return [src, { status, fedBy: s.fedBy, fedAt: s.fedAt, exportedAt: good ? s.exportedAt : null, rows: good ? s.rowCount : 0,
      lastFailedAt: s.lastFailedAt, lastFailReason: s.lastFailReason }];
  })) as Record<AuditSource, SourceMeta>;
}

export function buildYear(year: number, sources: StoredAuditSource[], roster: AuditRosterPerson[], cfg: AuditBuildConfig, now: Date): AuditSnapshotV2 {
  const { fed, skipped, notes } = parseAll(year, sources, cfg);
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
    team: x.team, connect: [...x.connects].sort()[0] ?? null, decision: [...x.decisions].sort().at(-1) ?? null,
    lastSeen: [...x.svc, ...x.grp].sort().at(-1) ?? null, phone: x.phone, phoneIsParent: x.phoneIsParent,
  })).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));

  const weekly = weeklySeries(year, students, people, svc, groups, cfg.serviceDayOfWeek);
  return {
    version: 2, generatedAt: now.toISOString(), dataStartDate, dataEndDate, terms: agg.terms, students, perTerm,
    lgStatsByTerm: buildLifegroupStats(groups, agg.terms, cfg.serviceDayOfWeek), weekly,
    followUp: followUp(students, people, weekly, cfg.serviceDayOfWeek), signals: { quadDrop: quadDrop(weekly, agg.terms) },
    sources: sourcesMeta(sources, year),
    quality: { skipped, notes, unmatched: unmatched(all), duplicates: duplicates(all) },
  };
}
