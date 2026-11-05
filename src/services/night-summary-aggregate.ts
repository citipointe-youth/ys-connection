// Friday night check: pure aggregates behind POST /sync/night-summary. Counts and closed values only; a value outside its
// closed list becomes 'other', so a name in a column can never reach the output. Every result is parsed by its schema upstream.
import { ACTION_TYPES, INTAKE_TYPES, LINK_REV, REASONS, REFUSAL_CODES, ERROR_CODE_RE,
  type NightOutbox, type NightTaps, type NightErrors, type NightImports, type NightConsole, type NightServices } from '../core/link-contract';
import type { NightOutboxRow, NightTapRow } from '../repositories/interfaces/night-summary.repository';
import type { ErrorLogView } from './error-log.service';
import type { ImportRecord } from '../core/entities/attendance';
import type { ConsoleRow, MirrorStateRow, LinkServiceRow } from '../core/link-types';

const DOOR: readonly string[] = ['checkIn', 'checkOut', 'firstTimerCheckIn'];
const INTAKE: readonly string[] = INTAKE_TYPES;
const bucket = (type: string) => (DOOR.includes(type) ? 'door' : INTAKE.includes(type) ? 'intake' : 'other') as 'door' | 'intake' | 'other';
const iso = (s: string) => new Date(s).toISOString();

/** Nearest rank, p in 0..100. Empty gives 0. */
export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, Math.ceil((p / 100) * sortedAsc.length))) - 1]!;
}

export function aggregateOutbox(rows: NightOutboxRow[], now: Date): NightOutbox {
  const groups = new Map<string, NightOutbox['groups'][number]>();
  const lat = { door: [] as number[], intake: [] as number[], other: [] as number[] };
  const att = { door: { a1: 0, a2to4: 0, a5plus: 0, max: 0 }, intake: { a1: 0, a2to4: 0, a5plus: 0, max: 0 }, other: { a1: 0, a2to4: 0, a5plus: 0, max: 0 } };
  const openTotals = { unclear: 0, pending: 0, claimed: 0 };
  let oldestPending: number | null = null;
  for (const r of rows) {
    if (r.status === 'unclear' || r.status === 'pending' || r.status === 'claimed') openTotals[r.status]++;
    if (r.status === 'pending') { const t = Date.parse(r.createdAt); if (oldestPending === null || t < oldestPending) oldestPending = t; }
    if (!r.inWindow) continue;
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
