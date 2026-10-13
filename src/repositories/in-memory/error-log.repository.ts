// In-memory admin Error log (T3). Memory mode is dev/test only, no json persistence.
import type { ErrorCategory, ErrorLogEntry, ErrorLogRow, IErrorLogRepository } from '../interfaces/error-log.repository';

export class InMemoryErrorLogRepository implements IErrorLogRepository {
  private rows = new Map<string, ErrorLogRow>();

  async record(e: ErrorLogEntry, setCount?: number): Promise<void> {
    const old = this.rows.get(e.id);
    if (!old) {
      this.rows.set(e.id, { id: e.id, category: e.category, code: e.code, route: e.route, status: e.status, message: e.message,
        count: setCount ?? 1, firstSeen: e.at, lastSeen: e.at, lastRole: e.role, minimised: false, ignored: false });
      return;
    }
    const count = setCount ?? old.count + 1;
    if (count !== old.count) old.lastSeen = e.at;
    Object.assign(old, { count, lastRole: e.role ?? old.lastRole, message: e.message });
  }

  async list(): Promise<ErrorLogRow[]> {
    return [...this.rows.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, 500).map((r) => ({ ...r }));
  }

  async setFlags(id: string, flags: { minimised?: boolean; ignored?: boolean }): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return false;
    if (flags.minimised !== undefined) r.minimised = flags.minimised;
    if (flags.ignored !== undefined) r.ignored = flags.ignored;
    return true;
  }

  async remove(id: string): Promise<boolean> { return this.rows.delete(id); }

  async removeAll(category?: ErrorCategory): Promise<number> {
    let n = 0;
    for (const [k, r] of this.rows) if (!category || r.category === category) { this.rows.delete(k); n++; }
    return n;
  }

  async purgeBefore(iso: string): Promise<void> {
    for (const [k, r] of this.rows) if (r.lastSeen < iso) this.rows.delete(k);
  }
}
