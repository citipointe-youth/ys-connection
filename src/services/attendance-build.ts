import { computeQuad } from '../core/types/enums';
import { saturdayOf } from './terms';
import type { LabeledTerm } from './year-terms';

// Attendance models for the Connection Audit (spec ys-connection/2026-10-22-connection-audit §5.1). The rows arrive
// already parsed by audit-parse.ts (names, gender, grade, dates, group leaders) and already carry the person id
// audit-build.ts gave them, so nothing here reads Elvanto columns or guesses a date.

// ── service ──
export interface BuiltSession { id: string; sessionDate: string; isValid: boolean } // id = the ISO date (one session per date)
export interface ServiceParsed { sessions: BuiltSession[]; attendance: { id: string; sessionId: string }[] }

export function buildServiceModel(rows: { id: string; dates: string[] }[], serviceMinAttendance: number): ServiceParsed {
  const seen = new Set<string>(), count = new Map<string, number>(), attendance: ServiceParsed['attendance'] = [];
  for (const r of rows) for (const d of r.dates) {
    if (seen.has(`${r.id}|${d}`)) continue;
    seen.add(`${r.id}|${d}`);
    attendance.push({ id: r.id, sessionId: d });
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  // ponytail: a session column nobody attended is not seen; it would be invalid for any floor >= 1 anyway
  const sessions = [...count].sort(([a], [b]) => a.localeCompare(b))
    .map(([d, n]) => ({ id: d, sessionDate: d, isValid: n >= serviceMinAttendance }));
  return { sessions, attendance };
}

// ── group ──
export interface BuiltWeek { id: string; weekStart: string }
export interface GroupParsed { weeks: BuiltWeek[]; attendance: { id: string; weekId: string; attended: boolean }[] }
export interface GroupInput {
  name: string;
  meetings: string[];
  members: { id: string; first_name: string; last_name: string; attendance: (boolean | null)[] }[]; // null = no mark
}

// Grade + gender from a lifegroup name, e.g. "Grade 9 Girls Lifegroup".
export function parseGroupMeta(name: string): { grade: number | null; gender: 'male' | 'female' | null } {
  const gm = name.match(/\bGrade\s+(\d+)\b/i);
  const grade = gm ? parseInt(gm[1]!, 10) : null;
  let gender: 'male' | 'female' | null = null;
  if (/\bboys?\b/i.test(name)) gender = 'male';
  else if (/\bgirls?\b/i.test(name)) gender = 'female';
  return { grade, gender };
}

export function buildGroupModel(groups: GroupInput[], serviceDayOfWeek = 5): GroupParsed {
  const weeks = new Map<string, BuiltWeek>(), seen = new Set<string>(), attendance: GroupParsed['attendance'] = [];
  groups.forEach((group, gi) => {
    const weekOf = group.meetings.map((d) => saturdayOf(d, serviceDayOfWeek));
    const ran = new Set<string>(); // weeks the group ran = weeks where a member has a mark
    for (const m of group.members) m.attendance.forEach((a, i) => { if (a !== null && a !== undefined) ran.add(weekOf[i]!); });
    for (const m of group.members) {
      const went = new Set(m.attendance.flatMap((a, i) => (a === true ? [weekOf[i]!] : [])));
      if (!went.size) continue; // 0 weeks -> not part of the group
      for (const w of ran) {
        const id = `${gi}|${w}`;
        if (!weeks.has(id)) weeks.set(id, { id, weekStart: w });
        if (seen.has(`${m.id}:${id}`)) continue;
        seen.add(`${m.id}:${id}`);
        attendance.push({ id: m.id, weekId: id, attended: went.has(w) });
      }
    }
  });
  return { weeks: [...weeks.values()], attendance };
}

// ── per-named-lifegroup, per-term stats (powers the audit Lifegroup Health tab) ──
// Lifegroup-centric: counts every attender of the group regardless of whether
// they matched a service record, bucketed into terms by the group's meeting week.
export interface AuditLgMember {
  firstName: string;
  lastName: string;
  attended: number; // weeks attended this term
  total: number;    // weeks the group ran this term
}

export interface AuditLgStat {
  lifegroupId: string;
  name: string;
  grade: number | null;
  gender: 'male' | 'female' | null;
  quad: string | null;
  members: number;        // distinct youth the group ran for this term
  uniqueAttenders: number;
  totalVisits: number;
  weeksRan: number;
  avgPerWeek: number;
  roster: AuditLgMember[]; // who attended, for the "click to see attendees" popup
}

export function buildLifegroupStats(groups: GroupInput[], terms: LabeledTerm[], serviceDayOfWeek = 5): Record<string, AuditLgStat[]> {
  const out: Record<string, AuditLgStat[]> = {};
  for (const t of terms) out[t.key] = [];
  if (!Array.isArray(groups) || groups.length === 0) return out;

  const termFor = (weekStart: string): string | null => {
    for (const t of terms) if (weekStart >= t.startDate && weekStart <= t.endDate) return t.key;
    return null;
  };

  groups.forEach((group, gi) => {
    const meta = parseGroupMeta(group.name);
    const quad = (computeQuad(meta.grade, meta.gender ?? 'other') as string | null) ?? null;
    const weekOfIdx = group.meetings.map((d) => saturdayOf(d, serviceDayOfWeek));
    const youth = group.members; // leaders were excluded by audit-parse (import.leaderTag)

    // termKey -> { weeks, members, attenders, visits, roster }
    const perTerm = new Map<string, {
      weeks: Set<string>; members: Set<string>; attenders: Set<string>; visits: number;
      roster: Map<string, { firstName: string; lastName: string; attended: number }>;
    }>();
    const ensure = (k: string) => {
      let a = perTerm.get(k);
      if (!a) { a = { weeks: new Set(), members: new Set(), attenders: new Set(), visits: 0, roster: new Map() }; perTerm.set(k, a); }
      return a;
    };

    for (const m of youth) {
      const key = m.id;
      for (let i = 0; i < m.attendance.length; i++) {
        const mark = m.attendance[i];
        if (mark === null || mark === undefined) continue;
        const w = weekOfIdx[i];
        if (!w) continue;
        const tk = termFor(w);
        if (!tk) continue;
        const acc = ensure(tk);
        acc.weeks.add(w);
        acc.members.add(key);
        let entry = acc.roster.get(key);
        if (!entry) { entry = { firstName: m.first_name, lastName: m.last_name, attended: 0 }; acc.roster.set(key, entry); }
        if (mark === true) { acc.attenders.add(key); acc.visits++; entry.attended++; }
      }
    }

    for (const [tk, acc] of perTerm) {
      const weeksRan = acc.weeks.size;
      out[tk]!.push({
        lifegroupId: 'lg' + gi,
        name: group.name,
        grade: meta.grade,
        gender: meta.gender,
        quad,
        members: acc.members.size,
        uniqueAttenders: acc.attenders.size,
        totalVisits: acc.visits,
        weeksRan,
        avgPerWeek: weeksRan ? Math.round(acc.visits / weeksRan) : 0,
        roster: [...acc.roster.values()]
          .map((r) => ({ firstName: r.firstName, lastName: r.lastName, attended: r.attended, total: weeksRan }))
          .sort((a, b) => b.attended - a.attended || a.firstName.localeCompare(b.firstName)),
      });
    }
  });

  return out;
}
