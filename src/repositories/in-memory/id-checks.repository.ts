// In-memory ID Checks (spec 2026-10-30 §7.1). No FK here, so an entry whose leader is gone reads as archived
// (leaderId null) and its ticks are ignored: the same result as Postgres's SET NULL / CASCADE.
import type { IIdCheckRepository } from '../interfaces/entity-repositories';
import type { IdCheckEntry, IdCheckTick } from '../../core/entities/id-check';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const newestFirst = (a: IdCheckEntry, b: IdCheckEntry) =>
  b.heldOn.localeCompare(a.heldOn) || b.updatedAt.localeCompare(a.updatedAt);

export class InMemoryIdCheckRepository implements IIdCheckRepository {
  private entries = new Map<string, IdCheckEntry>();
  private tickSet = new Set<string>(); // `${leaderId}|${userId}`

  constructor(private leaderExists: (id: string) => Promise<boolean>) {}

  async init(): Promise<void> { this.entries.clear(); this.tickSet.clear(); }

  /** Every entry as Postgres would hold it: a missing leader reads as null. */
  private async all(): Promise<IdCheckEntry[]> {
    const out: IdCheckEntry[] = [];
    for (const e of this.entries.values()) {
      const leaderId = e.leaderId && (await this.leaderExists(e.leaderId)) ? e.leaderId : null;
      out.push({ ...clone(e), leaderId });
    }
    return out;
  }

  async findEntry(id: string): Promise<IdCheckEntry | null> {
    return (await this.all()).find((e) => e.id === id) ?? null;
  }
  async listByLeader(leaderId: string): Promise<IdCheckEntry[]> {
    return (await this.all()).filter((e) => e.leaderId === leaderId).sort(newestFirst);
  }
  async lastFinished(leaderIds: string[]): Promise<Map<string, string>> {
    const want = new Set(leaderIds);
    const m = new Map<string, string>();
    for (const e of await this.all()) {
      if (!e.leaderId || !want.has(e.leaderId) || e.kind !== 'check' || !e.finished) continue;
      if ((m.get(e.leaderId) ?? '') < e.heldOn) m.set(e.leaderId, e.heldOn);
    }
    return m;
  }
  async inProgress(leaderIds: string[]): Promise<Map<string, { id: string; authorId: string; authorName: string }>> {
    const want = new Set(leaderIds);
    const m = new Map<string, { id: string; authorId: string; authorName: string }>();
    for (const e of (await this.all()).sort(newestFirst)) {
      if (!e.leaderId || !want.has(e.leaderId) || e.kind !== 'check' || e.finished || m.has(e.leaderId)) continue;
      m.set(e.leaderId, { id: e.id, authorId: e.authorId, authorName: e.authorName });
    }
    return m;
  }
  async upsert(e: IdCheckEntry): Promise<IdCheckEntry> {
    const old = this.entries.get(e.id);
    const row: IdCheckEntry = old
      ? { ...clone(e), kind: old.kind, authorId: old.authorId, authorName: old.authorName, createdAt: old.createdAt,
          finished: old.finished || e.finished }
      : clone(e);
    this.entries.set(e.id, row);
    return (await this.findEntry(e.id))!;
  }
  async deleteEntry(id: string): Promise<void> { this.entries.delete(id); }

  async ticks(): Promise<IdCheckTick[]> {
    const out: IdCheckTick[] = [];
    for (const k of this.tickSet) {
      const [leaderId, userId] = k.split('|') as [string, string];
      if (await this.leaderExists(leaderId)) out.push({ leaderId, userId });
    }
    return out;
  }
  async ticksForLeader(leaderId: string): Promise<IdCheckTick[]> {
    return (await this.ticks()).filter((t) => t.leaderId === leaderId);
  }
  async setTicks(userId: string, leaderIds: string[], on: boolean): Promise<void> {
    for (const l of leaderIds) on ? this.tickSet.add(`${l}|${userId}`) : this.tickSet.delete(`${l}|${userId}`);
  }

  async archivedGroups(): Promise<{ name: string; count: number; lastOn: string }[]> {
    const m = new Map<string, { name: string; count: number; lastOn: string }>();
    for (const e of await this.all()) {
      if (e.leaderId) continue;
      const g = m.get(e.leaderName) ?? { name: e.leaderName, count: 0, lastOn: '' };
      g.count++;
      if (e.heldOn > g.lastOn) g.lastOn = e.heldOn;
      m.set(e.leaderName, g);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  private async archivedIds(name: string): Promise<string[]> {
    return (await this.all()).filter((e) => !e.leaderId && e.leaderName === name).map((e) => e.id);
  }
  async deleteArchived(name: string): Promise<number> {
    const ids = await this.archivedIds(name);
    for (const id of ids) this.entries.delete(id);
    return ids.length;
  }
  async attachArchived(name: string, leaderId: string, leaderName: string): Promise<number> {
    const ids = await this.archivedIds(name);
    for (const id of ids) { const e = this.entries.get(id)!; e.leaderId = leaderId; e.leaderName = leaderName; }
    return ids.length;
  }
}
