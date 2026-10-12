// In-memory Elvanto link repo (spec 2026-10-12-elvanto-link-app-design.md §4.1). Used for `memory` and `json`
// persistence; never saved to disk. Deep-clones on every read and write. `now` stands in for the DB clock.
import type { ILinkRepository, LinkActionFilter, LinkRosterPushRow } from '../interfaces/link.repository';
import type { ClaimArgs, ClaimedRow, ConsoleRow, LinkFlowRow, LinkGroupRow, LinkLogRow, LinkRosterRow, LinkServiceRow,
  LogEvent, Match, MirrorStateRow, NewOutboxRow, OutboxRow, PushKind, ResultItem, ResultReply, Status } from '../../core/link-types';
import { LinkIdExists, LinkOpenDuplicate } from '../../core/errors/link-errors';
import { applyOutcome } from '../../services/link-rules';

const OPEN: Status[] = ['pending', 'claimed', 'unclear'];
const FINAL: Status[] = ['sent', 'refused', 'shadowed', 'cancelled'];
const DAY = 86_400_000;
const clone = <T>(v: T): T => structuredClone(v);

export interface InMemoryLinkOptions {
  /** Decrypts a stored note at claim time. Default identity; a test can throw to make a note unreadable. */
  decrypt?: (note: string, id: string) => string;
  now?: () => Date;
}

export class InMemoryLinkRepository implements ILinkRepository {
  private outbox = new Map<string, { row: OutboxRow; seq: number }>();
  private seq = 0;
  private consoles = new Map<string, ConsoleRow>();
  private rosterRows = new Map<string, LinkRosterRow>();
  private serviceRows: LinkServiceRow[] = [];
  private groupRows: LinkGroupRow[] = [];
  private flowRows: LinkFlowRow[] = [];
  private mirror = new Map<PushKind, MirrorStateRow>();
  private log: LinkLogRow[] = [];
  private decrypt: (note: string, id: string) => string;
  private clock: () => Date;

  constructor(opts: InMemoryLinkOptions = {}) {
    this.decrypt = opts.decrypt ?? ((n) => n);
    this.clock = opts.now ?? (() => new Date());
  }

  private nowMs() { return this.clock().getTime(); }
  private nowIso() { return this.clock().toISOString(); }

  async insertAction(n: NewOutboxRow): Promise<OutboxRow> {
    if (this.outbox.has(n.id)) throw new LinkIdExists(n.id); // on conflict (id) do nothing
    for (const { row } of this.outbox.values()) {
      if (row.dedupeKey === n.dedupeKey && OPEN.includes(row.status)) throw new LinkOpenDuplicate(row.id);
    }
    const now = this.nowIso();
    const row: OutboxRow = { ...clone(n), status: 'pending', reason: null, detail: null, attempts: 0, retryAt: null,
      leaseOwner: null, leaseUntil: null, resultAt: null, sentLogKey: null, reportId: null, createdAt: now, updatedAt: now };
    this.outbox.set(n.id, { row, seq: this.seq++ });
    return clone(row);
  }

  async getAction(id: string): Promise<OutboxRow | null> {
    const e = this.outbox.get(id);
    return e ? { ...clone(e.row), note: null, hasNote: e.row.note !== null } : null;
  }

  async listActions(f: LinkActionFilter): Promise<OutboxRow[]> {
    const p = (r: OutboxRow, k: string) => (r.payload as Record<string, unknown>)[k];
    return [...this.outbox.values()]
      .filter(({ row: r }) =>
        (!f.ids || f.ids.includes(r.id)) && (!f.createdBy || r.createdBy === f.createdBy) &&
        (!f.serviceDateFrom || r.serviceDate >= f.serviceDateFrom) && (!f.serviceDateTo || r.serviceDate <= f.serviceDateTo) &&
        (!f.types || f.types.includes(r.type)) && (!f.statuses || f.statuses.includes(r.status)) &&
        (!f.personId || r.personId === f.personId) && (!f.serviceTimeId || p(r, 'serviceTimeId') === f.serviceTimeId) &&
        (!f.groupId || p(r, 'groupId') === f.groupId))
      .sort((a, b) => cmpDesc(a, b))
      .map(({ row }) => ({ ...clone(row), note: null, hasNote: row.note !== null }));
  }

  async cancelPending(id: string): Promise<boolean> {
    const e = this.outbox.get(id);
    if (!e || e.row.status !== 'pending') return false;
    e.row.status = 'cancelled';
    e.row.updatedAt = this.nowIso();
    return true;
  }

  async claim(a: ClaimArgs): Promise<ClaimedRow[]> {
    const now = this.nowMs(); const nowIso = this.nowIso();
    this.consoles.set(a.console.consoleId, { ...clone(a.console), lastSeenAt: nowIso });
    // sweep
    for (const { row } of this.outbox.values()) {
      if (row.status === 'pending' && Date.parse(row.createdAt) < now - a.cutoffDays * DAY) {
        Object.assign(row, { status: 'refused', reason: 'too-old', resultAt: nowIso, updatedAt: nowIso });
      } else if (row.status === 'claimed' && row.leaseOwner !== a.console.consoleId && row.leaseUntil
        && Date.parse(row.leaseUntil) < now - a.leaseLostMs) { // B1 / X6: the owner reclaims its own rows instead
        Object.assign(row, { status: 'unclear', reason: 'lease-lost', resultAt: nowIso, updatedAt: nowIso });
      }
    }
    // purge (§4.3)
    for (const [k, r] of this.rosterRows) {
      if (!r.active && (r.match === 'none' || r.match === 'ignored') && Date.parse(r.updatedAt) < now - 90 * DAY) this.rosterRows.delete(k);
    }
    for (const { row } of this.outbox.values()) {
      if (FINAL.includes(row.status) && row.note !== null && Date.parse(row.createdAt) < now - 30 * DAY) row.note = null;
    }
    this.log = this.log.filter((l) => Date.parse(l.at) >= now - 400 * DAY);
    // lease
    const caps = a.console.capabilities;
    // B4 / APP-3: a checkOut waits while an older checkIn for the same person and service is pending or claimed.
    const blocked = (e: { row: OutboxRow; seq: number }) => e.row.type === 'checkOut' && [...this.outbox.values()].some((i) =>
      i.row.type === 'checkIn' && i.row.personId === e.row.personId
      && (i.row.payload as { serviceTimeId?: string }).serviceTimeId === (e.row.payload as { serviceTimeId?: string }).serviceTimeId
      && (i.row.status === 'pending' || i.row.status === 'claimed') && cmpDesc(i, e) > 0);
    const due = [...this.outbox.values()].filter((e) => !blocked(e)).filter(({ row: r }) => caps[r.type] !== 'off' && (
      (r.status === 'pending' && (r.retryAt === null || Date.parse(r.retryAt) <= now)) ||
      (r.status === 'claimed' && r.leaseOwner === a.console.consoleId && r.leaseUntil !== null && Date.parse(r.leaseUntil) < now)))
      .sort((x, y) => -cmpDesc(x, y))
      .slice(0, Math.max(0, a.max));
    const out: ClaimedRow[] = [];
    for (const { row } of due) {
      const reclaimed = row.status === 'claimed';
      Object.assign(row, { status: 'claimed', leaseOwner: a.console.consoleId,
        leaseUntil: new Date(now + a.leaseSeconds * 1000).toISOString(), attempts: row.attempts + 1, updatedAt: nowIso });
      let note: string | null = null;
      try {
        note = row.note === null ? null : this.decrypt(row.note, row.id);
      } catch {
        Object.assign(row, { status: 'refused', reason: 'note-unreadable', leaseOwner: null, leaseUntil: null, resultAt: nowIso });
        out.push({ row: { ...clone(row), note: null }, reclaimed, noteUnreadable: true });
        continue;
      }
      out.push({ row: { ...clone(row), note }, reclaimed, noteUnreadable: false });
    }
    return out;
  }

  /** Per item, in order: applyOutcome on the stored row, then write it. No await between read and write, so no guard needed. */
  async applyResults(consoleId: string, items: ResultItem[], now: Date): Promise<ResultReply> {
    const reply: ResultReply = { applied: [], ignored: [] };
    for (const item of items) {
      const e = this.outbox.get(item.id);
      const res = applyOutcome(e ? clone(e.row) : null, item, consoleId, now);
      if ('ignored' in res) { reply.ignored.push({ id: item.id, why: res.ignored }); continue; }
      Object.assign(e!.row, clone(res.next));
      reply.applied.push(item.id);
    }
    return reply;
  }

  async listConsoles(): Promise<ConsoleRow[]> { return clone([...this.consoles.values()]); }

  async replaceMirror(kind: PushKind, rows: unknown[], meta: { takenAt: string; consoleId: string }) {
    const prev = this.mirror.get(kind);
    if (prev && Date.parse(meta.takenAt) <= Date.parse(prev.takenAt)) return { applied: false, rows: 0 };
    const now = this.nowIso();
    if (kind === 'roster') {
      const seen = new Set<string>();
      for (const p of rows as LinkRosterPushRow[]) {
        seen.add(p.personId);
        const old = this.rosterRows.get(p.personId);
        this.rosterRows.set(p.personId, { personId: p.personId, firstName: p.firstName, lastName: p.lastName,
          gender: p.gender, grade: p.grade, kind: p.kind, active: true, studentId: old?.studentId ?? null,
          match: old?.match ?? 'none', updatedAt: now });
      }
      for (const r of this.rosterRows.values()) if (!seen.has(r.personId) && r.active) { r.active = false; r.updatedAt = now; }
    } else if (kind === 'services') {
      this.serviceRows = clone(rows as LinkServiceRow[]);
    } else if (kind === 'groups') {
      this.groupRows = (rows as LinkGroupRow[]).map((g) => ({ ...clone(g), grade: g.grade ?? null, gender: g.gender ?? null }));
    } else {
      this.flowRows = clone(rows as LinkFlowRow[]);
    }
    this.mirror.set(kind, { kind, takenAt: meta.takenAt, consoleId: meta.consoleId, rowCount: rows.length, appliedAt: now });
    return { applied: true, rows: rows.length };
  }

  // Same orders as the Supabase repo.
  async mirrorState(): Promise<MirrorStateRow[]> { return clone([...this.mirror.values()].sort((a, b) => cmp(a.kind, b.kind))); }
  async roster(): Promise<LinkRosterRow[]> {
    return clone([...this.rosterRows.values()].sort((a, b) =>
      cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName) || cmp(a.personId, b.personId)));
  }
  async services(): Promise<LinkServiceRow[]> {
    return clone([...this.serviceRows].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || cmp(a.serviceTimeId, b.serviceTimeId)));
  }
  async groups(): Promise<LinkGroupRow[]> { return clone([...this.groupRows].sort((a, b) => cmp(a.name, b.name) || cmp(a.groupId, b.groupId))); }
  async flows(): Promise<LinkFlowRow[]> {
    return clone([...this.flowRows].sort((a, b) => cmp(a.flowName, b.flowName) || a.stepOrder - b.stepOrder ||
      cmp(a.name, b.name) || cmp(a.rowId, b.rowId)));
  }

  async setMatches(changes: { personId: string; studentId: string | null; match: Match }[]): Promise<void> {
    const now = this.nowIso();
    for (const c of changes) {
      const r = this.rosterRows.get(c.personId);
      if (!r) continue;
      if (c.studentId !== null && [...this.rosterRows.values()].some((o) => o.personId !== c.personId && o.studentId === c.studentId)) {
        throw new Error('link_roster: student already matched to another person'); // link_roster_student_uq
      }
      Object.assign(r, { studentId: c.studentId, match: c.match, updatedAt: now });
    }
  }

  async addLog(rows: LinkLogRow[]): Promise<void> { // on conflict (id) do nothing
    for (const r of rows) if (!this.log.some((l) => l.id === r.id)) this.log.push(clone(r));
  }

  async listLog(f: { from: string; to: string; userId?: string; event?: LogEvent; limit: number }): Promise<LinkLogRow[]> {
    const from = Date.parse(f.from); const to = Date.parse(f.to);
    return clone(this.log
      .filter((l) => { const t = Date.parse(l.at); return t >= from && t < to && (!f.userId || l.userId === f.userId) && (!f.event || l.event === f.event); })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, f.limit));
  }

  /** Test-only: set a column (snake_case) on a stored row, to age it. */
  _backdate(table: 'link_outbox' | 'link_roster' | 'link_log', id: string, column: string, value: string): void {
    const key = column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const target = table === 'link_outbox' ? this.outbox.get(id)?.row
      : table === 'link_roster' ? this.rosterRows.get(id) : this.log.find((l) => l.id === id);
    if (!target || !(key in target)) throw new Error(`_backdate: no ${table}.${column} for ${id}`);
    (target as unknown as Record<string, unknown>)[key] = value;
  }
  /** Test-only: the stored note as plaintext. */
  _peekNote(id: string): string | null { return this.outbox.get(id)?.row.note ?? null; }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function cmpDesc(a: { row: OutboxRow; seq: number }, b: { row: OutboxRow; seq: number }): number {
  return Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt) || b.seq - a.seq;
}
