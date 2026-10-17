// Reconciliation check rules (spec 2026-10-17 §5.3-5.7). Pure: no repos, no clock. Ids in, ids out; never a name.
import type { LinkRosterRow, OutboxRow } from '../core/link-types';
import type { LifegroupAttendance, LifegroupWeek, ServiceAttendance, ServiceSession } from '../core/entities/attendance';
import { saturdayOf } from './terms';

/** F7: set false if the dry run shows the Elvanto group export keeps removed members on the roll. */
export const CHECK_REMOVALS = true;

export type CheckInVerdict = 'matched' | 'sent-not-imported' | 'practice-matched' | 'practice-missing' | 'no-student';
export type CheckInRow = Pick<OutboxRow, 'id' | 'personId' | 'studentId' | 'status' | 'serviceDate'>;
export interface CheckInVerdictRow { row: CheckInRow; person: LinkRosterRow | undefined; studentId: string | null; verdict: CheckInVerdict }
export interface LgRef { id: string; elvantoGroupId?: string | null }
type Act = Pick<OutboxRow, 'type' | 'status' | 'payload' | 'resultAt'>;

/** The shadowCheck verdict loop, shared (link.service shadowCheck and check 1). */
export function compareCheckIns(attended: Set<string>, roster: LinkRosterRow[], rows: CheckInRow[]): CheckInVerdictRow[] {
  const byId = new Map(roster.map((r) => [r.personId, r]));
  return rows.map((row) => {
    const person = row.personId ? byId.get(row.personId) : undefined;
    const studentId = row.studentId ?? person?.studentId ?? null;
    const verdict: CheckInVerdict = !studentId ? 'no-student'
      : row.status === 'sent' ? (attended.has(studentId) ? 'matched' : 'sent-not-imported')
        : (attended.has(studentId) ? 'practice-matched' : 'practice-missing');
    return { row, person, studentId, verdict };
  });
}

export function checkCheckins(i: {
  sessions: Pick<ServiceSession, 'id' | 'sessionDate'>[];
  attendance: Pick<ServiceAttendance, 'sessionId' | 'studentId' | 'attended'>[];
  roster: LinkRosterRow[]; rows: CheckInRow[];
}) {
  const dateOf = new Map(i.sessions.map((s) => [s.id, s.sessionDate.slice(0, 10)]));
  const seen = new Set<string>();
  const items: { personId: string; date: string }[] = [];
  for (const date of new Set(dateOf.values())) {
    const attended = new Set(i.attendance.filter((a) => a.attended && dateOf.get(a.sessionId) === date).map((a) => a.studentId));
    const rows = i.rows.filter((r) => r.status === 'sent' && r.serviceDate === date);
    for (const v of compareCheckIns(attended, i.roster, rows)) {
      if (v.verdict !== 'sent-not-imported' || v.person?.kind === 'leader' || !v.row.personId) continue;
      const k = `${v.row.personId}|${date}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ personId: v.row.personId, date });
    }
  }
  return { count: items.length, items };
}

export function checkUnmatched(roster: LinkRosterRow[]) {
  const items = roster.filter((r) => r.kind === 'student' && r.active && (r.match === 'none' || r.match === 'ambiguous')).map((r) => r.personId);
  return { count: items.length, items };
}

const inWindow = (a: Act, sinceIso: string, beforeIso: string) =>
  a.status === 'sent' && !!a.resultAt && a.resultAt >= sinceIso && a.resultAt < beforeIso;

/** Newest by resultAt per key. */
function newest(acts: Act[], key: (a: Act) => string): Act[] {
  const m = new Map<string, Act>();
  for (const a of acts) { const k = key(a); const o = m.get(k); if (!o || (a.resultAt ?? '') > (o.resultAt ?? '')) m.set(k, a); }
  return [...m.values()];
}

export function checkLifegroups(i: {
  actions: Act[]; lifegroups: LgRef[]; weeks: Pick<LifegroupWeek, 'id' | 'weekKey'>[];
  attendance: Pick<LifegroupAttendance, 'weekId' | 'lifegroupId' | 'studentId' | 'attended'>[];
  roster: LinkRosterRow[]; today: string; sinceIso: string; beforeIso: string; serviceDayOfWeek: number;
}) {
  const noId = i.lifegroups.filter((g) => !g.elvantoGroupId).map((g) => g.id);
  const lgByGroup = new Map(i.lifegroups.filter((g) => g.elvantoGroupId).map((g) => [g.elvantoGroupId as string, g.id]));
  const weekKeyOf = new Map(i.weeks.map((w) => [w.id, w.weekKey]));
  const byPerson = new Map(i.roster.map((r) => [r.personId, r]));
  const reports = newest(i.actions.filter((a) => (a.type === 'submitReport' || a.type === 'editReport') && inWindow(a, i.sinceIso, i.beforeIso)
    && String(a.payload['date'] ?? '') <= i.today), (a) => `${a.payload['groupId']}|${a.payload['date']}`);
  const items: { groupId: string; date: string; personIds: string[] }[] = [];
  for (const a of reports) {
    const groupId = String(a.payload['groupId']); const date = String(a.payload['date']);
    const lgId = lgByGroup.get(groupId);
    if (!lgId) continue;
    const wk = saturdayOf(date, i.serviceDayOfWeek);
    const attended = new Set(i.attendance.filter((x) => x.attended && x.lifegroupId === lgId && weekKeyOf.get(x.weekId) === wk).map((x) => x.studentId));
    if (a.payload['didNotMeet'] === true) {
      if (attended.size > 0) items.push({ groupId, date, personIds: [] });
      continue;
    }
    const missing = ((a.payload['attendees'] as string[] | undefined) ?? []).filter((pid) => {
      const p = byPerson.get(pid);
      return p && p.kind !== 'leader' && p.studentId && !attended.has(p.studentId);
    });
    if (missing.length) items.push({ groupId, date, personIds: missing });
  }
  return { count: items.length, items, noId };
}

export function checkMembers(i: {
  actions: Act[]; lifegroups: LgRef[]; roll: { lifegroupId: string; nameKey: string }[]; roster: LinkRosterRow[];
  keyOf: (r: LinkRosterRow) => string; sinceIso: string; beforeIso: string; checkRemovals?: boolean;
}) {
  const removals = i.checkRemovals ?? CHECK_REMOVALS;
  const lgByGroup = new Map(i.lifegroups.filter((g) => g.elvantoGroupId).map((g) => [g.elvantoGroupId as string, g.id]));
  const roll = new Set(i.roll.map((r) => `${r.lifegroupId}|${r.nameKey}`));
  const byPerson = new Map(i.roster.map((r) => [r.personId, r]));
  const acts = newest(i.actions.filter((a) => (a.type === 'addGroupMember' || a.type === 'removeGroupMember') && inWindow(a, i.sinceIso, i.beforeIso)),
    (a) => `${a.payload['groupId']}|${a.payload['personId']}`);
  const items: { groupId: string; personId: string; op: 'add' | 'remove' }[] = [];
  for (const a of acts) {
    const groupId = String(a.payload['groupId']); const personId = String(a.payload['personId']);
    const lgId = lgByGroup.get(groupId); const p = byPerson.get(personId);
    if (!lgId || !p || p.kind === 'leader') continue;
    const onRoll = roll.has(`${lgId}|${i.keyOf(p)}`);
    if (a.type === 'addGroupMember' && !onRoll) items.push({ groupId, personId, op: 'add' });
    if (a.type === 'removeGroupMember' && onRoll && removals) items.push({ groupId, personId, op: 'remove' });
  }
  return { count: items.length, items };
}
