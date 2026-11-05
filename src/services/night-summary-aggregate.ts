// Friday night check: pure aggregates behind POST /sync/night-summary. Counts and closed values only; a value outside its
// closed list becomes 'other', so a name in a column can never reach the output. Every result is parsed by its schema upstream.
import { ACTION_TYPES, INTAKE_TYPES, LINK_REV, REASONS, REFUSAL_CODES, ERROR_CODE_RE,
  type NightOutbox, type NightTaps, type NightErrors, type NightImports, type NightConsole, type NightServices, type NightRoster, type NightPeople } from '../core/link-contract';
import type { NightOutboxRow, NightTapRow, NightIntakeRow, NightUnsentRow, NightRosterRow } from '../repositories/interfaces/night-summary.repository';
import type { IntakeDateRow } from '../repositories/interfaces/link-intake.repository';
import { classifyHold } from './night-summary-holds';
import type { ErrorLogView } from './error-log.service';
import type { ImportRecord } from '../core/entities/attendance';
import type { ConsoleRow, MirrorStateRow, LinkServiceRow } from '../core/link-types';

const DOOR: readonly string[] = ['checkIn', 'checkOut', 'firstTimerCheckIn'];
const INTAKE: readonly string[] = INTAKE_TYPES;
const bucket = (type: string) => (DOOR.includes(type) ? 'door' : INTAKE.includes(type) ? 'intake' : 'other') as 'door' | 'intake' | 'other';
export const iso = (s: string) => new Date(s).toISOString();

/** Nearest rank, p in 0..100. Empty gives 0. */
export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, Math.ceil((p / 100) * sortedAsc.length))) - 1]!;
}

/** `to` (ISO) ends the window: service_date is a whole site day, so a row created at or after `to` (a later service) is not this night's. */
export function aggregateOutbox(rows: NightOutboxRow[], now: Date, to?: string): NightOutbox {
  const end = to === undefined ? Infinity : Date.parse(to);
  const groups = new Map<string, NightOutbox['groups'][number]>();
  const lat = { door: [] as number[], intake: [] as number[], other: [] as number[] };
  const att = { door: { a1: 0, a2to4: 0, a5plus: 0, max: 0 }, intake: { a1: 0, a2to4: 0, a5plus: 0, max: 0 }, other: { a1: 0, a2to4: 0, a5plus: 0, max: 0 } };
  const openTotals = { unclear: 0, pending: 0, claimed: 0 };
  let oldestPending: number | null = null;
  for (const r of rows) {
    if (r.status === 'unclear' || r.status === 'pending' || r.status === 'claimed') openTotals[r.status]++;
    if (r.status === 'pending') { const t = Date.parse(r.createdAt); if (oldestPending === null || t < oldestPending) oldestPending = t; }
    if (!r.inWindow || Date.parse(r.createdAt) >= end) continue;
    const reason = r.reason === null ? null : (REASONS as readonly string[]).includes(r.reason) ? r.reason : 'other';
    const key = `${r.type}|${r.status}|${reason}`;
    const g = groups.get(key);
    if (g) g.n++; else groups.set(key, { type: r.type, status: r.status as NightOutbox['groups'][number]['status'], reason: reason as NightOutbox['groups'][number]['reason'], n: 1 });
    const b = bucket(r.type);
    if (r.resultAt !== null) lat[b].push(Math.max(0, Math.round((Date.parse(r.resultAt) - Date.parse(r.createdAt)) / 1000)));
    const a = att[b];
    if (r.attempts === 1) a.a1++; else if (r.attempts >= 2 && r.attempts <= 4) a.a2to4++; else if (r.attempts >= 5) a.a5plus++;
    a.max = Math.max(a.max, r.attempts);
  }
  const L = (xs: number[]) => { xs.sort((x, y) => x - y); return { n: xs.length, p50S: percentile(xs, 50), p95S: percentile(xs, 95), maxS: xs.length ? xs[xs.length - 1]! : 0 }; };
  return { groups: [...groups.values()], latency: { door: L(lat.door), intake: L(lat.intake), other: L(lat.other) }, attempts: att, openTotals,
    oldestPendingAgeS: oldestPending === null ? null : Math.max(0, Math.round((now.getTime() - oldestPending) / 1000)) };
}

export function aggregateTaps(rows: NightTapRow[], limit: number): NightTaps {
  const actions = ACTION_TYPES as readonly string[];
  const perMinute = new Map<string, number>();
  const devices = new Set<string>();
  const refused: Record<string, number> = {};
  let tapCount = 0, replay = 0;
  for (const r of rows) {
    if (!actions.includes(r.event)) continue; // identity, cancel, undo, resolve are not taps
    if (DOOR.includes(r.event)) {
      tapCount++;
      const m = iso(r.at).slice(0, 16);
      perMinute.set(m, (perMinute.get(m) ?? 0) + 1);
      if (r.deviceId) devices.add(r.deviceId);
    }
    if (r.outcome === 'replay') replay++;
    if (r.outcome.startsWith('refused:')) {
      const c = r.outcome.slice(8);
      const code = (REFUSAL_CODES as readonly string[]).includes(c) ? c : 'other';
      refused[code] = (refused[code] ?? 0) + 1;
    }
  }
  return { tapCount, peakPerMinute: Math.max(0, ...perMinute.values()), distinctDevices: devices.size, replay,
    refused: refused as NightTaps['refused'], truncated: rows.length === limit };
}

export function aggregateErrors(views: ErrorLogView[], total: number, from: string, to: string): NightErrors {
  const f = Date.parse(from), t = Date.parse(to);
  let ignored = 0;
  const groups = new Map<string, NightErrors['groups'][number]>();
  for (const v of views) {
    if (v.ignored) { ignored++; continue; }
    const code = v.category === 'client' ? 'client' : ERROR_CODE_RE.test(v.code) ? v.code : 'other';
    const ls = Date.parse(v.lastSeen);
    const inWindow = ls >= f && ls < t;
    const key = `${v.category}|${v.tier}|${v.status ?? ''}|${code}|${inWindow}`;
    const first = iso(v.firstSeen);
    const g = groups.get(key);
    if (g) { g.n += v.count; if (first < g.oldestFirstSeen) g.oldestFirstSeen = first; }
    else groups.set(key, { category: v.category, tier: v.tier, status: v.status, code, n: v.count, oldestFirstSeen: first, inWindow });
  }
  return { ignored, capped: total >= 500, groups: [...groups.values()] };
}

export function aggregateImports(service: ImportRecord[], lifegroup: ImportRecord[], from: string, to: string): NightImports {
  const f = Date.parse(from), t = Date.parse(to);
  const one = (r: ImportRecord) => ({ rowCount: r.rowCount, sessionsAdded: r.sessionsAdded, importedAt: iso(r.importedAt) });
  const previous = (xs: ImportRecord[]) => {
    const before = xs.filter((r) => Date.parse(r.importedAt) < f).sort((a, b) => Date.parse(b.importedAt) - Date.parse(a.importedAt))[0];
    return before ? one(before) : null;
  };
  const rows = [...service, ...lifegroup].filter((r) => { const a = Date.parse(r.importedAt); return a >= f && a < t; })
    .sort((a, b) => Date.parse(a.importedAt) - Date.parse(b.importedAt)).map((r) => ({ type: r.type, status: r.status, ...one(r) }));
  return { rows, previous: { service: previous(service), lifegroup: previous(lifegroup) } };
}

/** `consoleVersion` is passed as is: one that fails the schema's format fails the whole section (a name would not pass quietly). */
export function aggregateConsole(consoles: ConsoleRow[], mirror: MirrorStateRow[], consoleId: string): NightConsole {
  return {
    consoles: consoles.map((c) => ({ self: c.consoleId === consoleId, lastSeenAt: iso(c.lastSeenAt), contractVersion: c.contractVersion,
      consoleVersion: c.consoleVersion, linkRev: c.linkRev, inWindow: c.inWindow, pollSeconds: c.pollSeconds })),
    mirror: mirror.map((m) => ({ kind: m.kind, takenAt: iso(m.takenAt), appliedAt: iso(m.appliedAt), rowCount: m.rowCount })),
    appLinkRev: LINK_REV,
  };
}

/** Rows with fromYmd <= ymd <= toYmd; room and check-in counts only. */
export function aggregateServices(rows: LinkServiceRow[], fromYmd: string, toYmd: string): NightServices {
  return { rows: rows.filter((r) => r.ymd >= fromYmd && r.ymd <= toYmd)
    .map((r) => ({ ymd: r.ymd, startsAt: iso(r.startsAt), rooms: r.rooms.length, checkedIn: r.checkedIn.length })) };
}

/** The roster's predicate fields, as grouped by the repository. Nothing else of a roster row is read. */
export function aggregateRoster(rows: NightRosterRow[]): NightRoster {
  return { groups: rows.map((r) => ({ kind: r.kind, match: r.match, active: r.active, hasGrade: r.hasGrade, n: r.n })) };
}

/** The unsent queue is purged 14 days after created_at; a row older than 6 days is within 8 days of it (nearPurge). */
export const UNSENT_NEAR_PURGE_DAYS = 6;

/** The raw hold text is turned into a code here; two texts with one code (and one mode, date, status) sum. */
export function aggregatePeople(siteToday: string, intakeRows: NightIntakeRow[], dates: IntakeDateRow[], notFoundHeldInIntake: number,
  unsent: NightUnsentRow[], now: Date): NightPeople {
  const rows = new Map<string, NightPeople['rows'][number]>();
  for (const r of intakeRows) {
    const code = classifyHold(r.reason);
    const k = `${r.mode}|${r.date}|${r.status}|${code}`;
    const g = rows.get(k);
    if (g) g.n += r.n; else rows.set(k, { mode: r.mode, date: r.date, status: r.status, code, n: r.n });
  }
  const byReason = new Map<string, NightPeople['unsent'][number]>();
  const nearAt = now.getTime() - UNSENT_NEAR_PURGE_DAYS * 86_400_000;
  for (const u of unsent) {
    const t = Date.parse(u.createdAt);
    const age = Math.max(0, Math.round((now.getTime() - t) / 1000));
    const g = byReason.get(u.reason) ?? { reason: u.reason, n: 0, nearPurge: 0, oldestS: 0 };
    g.n++; if (t < nearAt) g.nearPurge++; g.oldestS = Math.max(g.oldestS, age);
    byReason.set(u.reason, g);
  }
  return { siteToday, rows: [...rows.values()],
    dates: dates.map((d) => ({ mode: d.mode, date: d.date, takenAt: d.takenAt === null ? null : iso(d.takenAt), rowCount: d.rowCount, cut: d.cut, refreshAsked: d.refreshAskedAt !== null })),
    notFoundHeldInIntake, unsent: [...byReason.values()] };
}
