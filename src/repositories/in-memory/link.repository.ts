// In-memory Elvanto link repo (spec 2026-10-12-elvanto-link-app-design.md §4.1). Used for `memory` and `json`
// persistence; never saved to disk. Deep-clones on every read and write. `now` stands in for the DB clock.
import type { ConsentLookupStored, ILinkRepository, LinkActionFilter, LinkRosterPushRow } from '../interfaces/link.repository';
import { CONSENT_LOOKUP_KEEP_MS } from '../interfaces/link.repository';
import type { ActionType, ClaimArgs, ClaimedRow, ConsoleRow, LinkFlowAssign, LinkFlowRow, LinkFlowStep, LinkGroupRow, LinkLogRow, LinkProgress, LinkRosterRow,
  LinkServiceRow, LogEvent, Match, MirrorStateRow, NewOutboxRow, OutboxRow, MirrorKind, ResultItem, ResultReply, Status,
} from '../../core/link-types';
import { LinkIdExists, LinkOpenDuplicate } from '../../core/errors/link-errors';
import { applyOutcome } from '../../services/link-rules';
import { INTAKE_TYPES, REHAND_REV, stickyConsent } from '../../core/link-contract';

const INTAKE = INTAKE_TYPES as readonly string[];

const OPEN: Status[] = ['pending', 'claimed', 'unclear'];
// APP-84: not link-rules FINAL (that one includes unclear); these rows may lose their note after 30 days.
const PURGEABLE: Status[] = ['sent', 'refused', 'shadowed', 'cancelled'];
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
  private progress = new Map<string, Record<string, LinkProgress>>(); // S5: per console (its own column in Postgres)
  private rosterRows = new Map<string, LinkRosterRow>();
  private serviceRows: LinkServiceRow[] = [];
  private groupRows: LinkGroupRow[] = [];
  private flowRows: LinkFlowRow[] = [];
  private assigns = new Map<string, LinkFlowAssign>(); // key flowId:personId
  private mirror = new Map<MirrorKind, MirrorStateRow>();
  private steps: LinkFlowStep[] | null = null;
  private log: LinkLogRow[] = [];
  private decrypt: (note: string, id: string) => string;
  private clock: () => Date;

  constructor(opts: InMemoryLinkOptions = {}) {
    this.decrypt = opts.decrypt ?? ((n) => n);
    this.clock = opts.now ?? (() => new Date());
  }

  private nowMs() { return this.clock().getTime(); }
  private nowIso() { return this.clock().toISOString(); }

  async insertAction(input: NewOutboxRow): Promise<OutboxRow> {
    const { supersede: s, ...n } = input;
    if (this.outbox.has(n.id)) throw new LinkIdExists(n.id); // on conflict (id) do nothing
    // S-4 / D8: the pending rows the insert supersedes; cancelled only when the insert goes through (one transaction).
    const gone = !s ? [] : [...this.outbox.values()].map((e) => e.row).filter((r) => r.status === 'pending' && r.type === s.type
      && (s.dedupeKey === undefined || r.dedupeKey === s.dedupeKey) && (s.createdBy === undefined || r.createdBy === s.createdBy)
      && (s.kind === undefined || (r.payload as { kind?: unknown }).kind === s.kind));
    for (const { row } of this.outbox.values()) {
      if (row.dedupeKey === n.dedupeKey && OPEN.includes(row.status) && !gone.includes(row)) throw new LinkOpenDuplicate(row.id);
    }
    const now = this.nowIso();
    for (const r of gone) Object.assign(r, { status: 'cancelled', detail: `cancelled-by:${n.id}`, updatedAt: now });
    const row: OutboxRow = { ...clone(n), status: 'pending', reason: null, detail: null, attempts: 0, retryAt: null,
      leaseOwner: null, leaseUntil: null, resultAt: null, sentLogKey: null, reportId: null, createdAt: now, updatedAt: now,
      steps: null, stop: null };
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
      .slice(0, f.limit)
      .map(({ row }) => ({ ...clone(row), note: null, hasNote: row.note !== null }));
  }

  async cancelPending(id: string, by?: string): Promise<boolean> {
    const e = this.outbox.get(id);
    if (!e || e.row.status !== 'pending') return false;
    e.row.status = 'cancelled';
    if (by) e.row.detail = `cancelled-by:${by}`;
    e.row.updatedAt = this.nowIso();
    return true;
  }

  async claim(a: ClaimArgs): Promise<ClaimedRow[]> {
    const now = this.nowMs(); const nowIso = this.nowIso();
    this.consoles.set(a.console.consoleId, { ...clone(a.console), lastSeenAt: nowIso });
    // sweep
    const tooOld = await this.sweepTooOld(a.cutoffDays); // not inside `?.push(...)`: that skips the call when swept is unset
    a.swept?.push(...tooOld);
    for (const { row } of this.outbox.values()) {
      if (row.status === 'claimed' && row.leaseOwner !== a.console.consoleId && row.leaseUntil
        && Date.parse(row.leaseUntil) < now - a.leaseLostMs) { // B1 / X6: the owner reclaims its own rows instead
        Object.assign(row, { status: 'unclear', reason: 'lease-lost', resultAt: nowIso, updatedAt: nowIso });
        a.swept?.push({ type: row.type, reason: 'lease-lost' });
      }
    }
    // purge (§4.3)
    for (const [k, r] of this.rosterRows) {
      if (!r.active && (r.match === 'none' || r.match === 'ignored') && Date.parse(r.updatedAt) < now - 90 * DAY) this.rosterRows.delete(k);
    }
    for (const { row } of this.outbox.values()) {
      if (PURGEABLE.includes(row.status) && row.note !== null && Date.parse(row.createdAt) < now - 30 * DAY) row.note = null;
    }
    this.log = this.log.filter((l) => Date.parse(l.at) >= now - 400 * DAY);
    // X19: an intake row's note goes once it is final; the row itself after 14 days.
    for (const [id, { row }] of this.outbox) {
      if (!INTAKE.includes(row.type) || row.status === 'pending' || row.status === 'claimed') continue;
      row.note = null;
      if (Date.parse(row.createdAt) < now - 14 * DAY) this.outbox.delete(id);
    }
    // lease
    const caps = a.console.capabilities;
    // B4 / APP-3: a checkOut waits while an older checkIn for the same person and service is pending or claimed.
    const blocked = (e: { row: OutboxRow; seq: number }) => e.row.type === 'checkOut' && [...this.outbox.values()].some((i) =>
      i.row.type === 'checkIn' && i.row.personId === e.row.personId
      && (i.row.payload as { serviceTimeId?: string }).serviceTimeId === (e.row.payload as { serviceTimeId?: string }).serviceTimeId
      && (i.row.status === 'pending' || i.row.status === 'claimed') && cmpDesc(i, e) > 0);
    const due = [...this.outbox.values()].filter((e) => !blocked(e)).filter(({ row: r }) => (caps[r.type] ?? 'off') !== 'off' && ( // X18: an unlisted type is off
      (r.status === 'pending' && (r.retryAt === null || Date.parse(r.retryAt) <= now)) ||
      (r.status === 'claimed' && r.leaseOwner === a.console.consoleId && r.leaseUntil !== null
        && (Date.parse(r.leaseUntil) < now || a.console.linkRev >= REHAND_REV)))) // C01 (rev 12): own live leases too
      // H1: pending first, so re-handed own leases a console keeps refusing can't starve new rows
      .sort((x, y) => Number(x.row.status === 'claimed') - Number(y.row.status === 'claimed') || -cmpDesc(x, y))
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

  async sweepTooOld(cutoffDays: number): Promise<{ type: ActionType; reason: 'too-old' }[]> {
    const now = this.nowMs(); const nowIso = this.nowIso();
    const out: { type: ActionType; reason: 'too-old' }[] = [];
    for (const { row } of this.outbox.values()) {
      const maxAge = INTAKE.includes(row.type) ? DAY : cutoffDays * DAY; // X19: an intake row waits at most 24 h
      if (row.status === 'pending' && Date.parse(row.createdAt) < now - maxAge) {
        Object.assign(row, { status: 'refused', reason: 'too-old', resultAt: nowIso, updatedAt: nowIso });
        out.push({ type: row.type, reason: 'too-old' });
      }
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

  async listConsoles(): Promise<ConsoleRow[]> {
    return clone([...this.consoles.values()].map((c) => ({ ...c, progress: this.progress.get(c.consoleId) ?? {} })));
  }
  async setProgress(consoleId: string, key: string, p: Omit<LinkProgress, 'at'>): Promise<void> {
    if (!this.consoles.has(consoleId)) return;
    const now = this.nowMs(), keep = Object.entries(this.progress.get(consoleId) ?? {}).filter(([, v]) => now - Date.parse(v.at) < 10 * 60_000);
    this.progress.set(consoleId, { ...Object.fromEntries(keep), [key]: { ...clone(p), at: this.nowIso() } });
  }

  async replaceMirror(kind: MirrorKind, rows: unknown[], meta: { takenAt: string; consoleId: string; steps?: LinkFlowStep[] }) {
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
          match: old?.match ?? 'none', updatedAt: now, consent: stickyConsent(old?.consent, p.consent) });
      }
      for (const r of this.rosterRows.values()) if (!seen.has(r.personId) && r.active) { r.active = false; r.updatedAt = now; }
    } else if (kind === 'services') {
      this.serviceRows = clone(rows as LinkServiceRow[]);
    } else if (kind === 'groups') {
      this.groupRows = (rows as LinkGroupRow[]).map((g) => ({ ...clone(g), grade: g.grade ?? null, gender: g.gender ?? null,
        history: clone(g.history ?? []) }));
    } else {
      this.flowRows = (rows as LinkFlowRow[]).map((f) => ({ ...clone(f), grade: f.grade ?? null, gender: f.gender ?? null,
        mobile: f.mobile ?? null, mobileIsParent: f.mobileIsParent ?? false, consent: f.consent ?? null, textedOn: f.textedOn ?? null }));
      const keep = new Set(this.flowRows.map((f) => `${f.flowId}:${f.personId}`));
      for (const k of this.assigns.keys()) if (!keep.has(k)) this.assigns.delete(k);
      this.steps = meta.steps ? clone(meta.steps) : null;
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

  async flowSteps(): Promise<LinkFlowStep[] | null> { return this.steps && clone(this.steps); }

  private lookups = new Map<string, ConsentLookupStored & { at: number }>();
  async putConsentLookup(r: ConsentLookupStored & { consoleId: string }): Promise<void> {
    const now = this.clock().getTime();
    for (const [k, v] of this.lookups) if (now - v.at > CONSENT_LOOKUP_KEEP_MS) this.lookups.delete(k);
    const { consoleId: _c, ...rest } = r;
    this.lookups.set(r.requestId, { ...clone(rest), at: now });
  }
  async consentLookup(requestId: string): Promise<ConsentLookupStored | null> {
    const v = this.lookups.get(requestId);
    if (!v || this.clock().getTime() - v.at > CONSENT_LOOKUP_KEEP_MS) return null;
    const { at: _a, ...rest } = v;
    return clone(rest);
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

  async flowAssignments(): Promise<LinkFlowAssign[]> { return clone([...this.assigns.values()]); }
  async setFlowAssign(a: { flowId: string; personId: string; leaderId: string | null; assignedBy: string }): Promise<void> {
    const k = `${a.flowId}:${a.personId}`;
    if (a.leaderId === null) this.assigns.delete(k);
    else this.assigns.set(k, { flowId: a.flowId, personId: a.personId, leaderId: a.leaderId, assignedBy: a.assignedBy, assignedAt: this.nowIso() });
  }

  async addLog(rows: LinkLogRow[]): Promise<void> { // on conflict (id) do nothing
    for (const r of rows) if (!this.log.some((l) => l.id === r.id)) this.log.push(clone(r));
  }

  async listLog(f: { from: string; to: string; userId?: string; event?: LogEvent; outboxId?: string; limit: number }): Promise<LinkLogRow[]> {
    const from = Date.parse(f.from); const to = Date.parse(f.to);
    return clone(this.log
      .filter((l) => { const t = Date.parse(l.at); return t >= from && t < to && (!f.userId || l.userId === f.userId) && (!f.event || l.event === f.event)
        && (!f.outboxId || l.outboxId === f.outboxId); })
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
