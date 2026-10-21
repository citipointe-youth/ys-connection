// In-memory admin Error log (T3, Part 1 fold). Memory mode is dev/test only.
import { FOLD_WINDOW_MS, type ErrorCategory, type ErrorLogEntry, type ErrorLogRow, type IErrorLogRepository } from '../interfaces/error-log.repository';
import type { ErrorTier } from '../../services/error-log-text';

export class InMemoryErrorLogRepository implements IErrorLogRepository {
  private rows = new Map<string, ErrorLogRow>();

  async record(e: ErrorLogEntry, setCount?: number): Promise<void> {
    if (setCount === 0) { this.rows.delete(e.id); return; }
    if (setCount === undefined && e.foldKey) {
      const cut = Date.parse(e.at) - FOLD_WINDOW_MS;
      let hit: ErrorLogRow | undefined;
      for (const r of this.rows.values()) {
        if (r.foldKey === e.foldKey && !r.ignored && Date.parse(r.lastSeen) > cut && (!hit || r.lastSeen > hit.lastSeen)) hit = r;
      }
      if (hit) {
        hit.count += e.n ?? 1;
        if (e.at > hit.lastSeen) hit.lastSeen = e.at;
        hit.lastRole = e.role ?? hit.lastRole;
        return;
      }
    }
    const old = this.rows.get(e.id);
    if (!old) {
      this.rows.set(e.id, { id: e.id, category: e.category, code: e.code, route: e.route, status: e.status, message: e.message,
        count: setCount ?? e.n ?? 1, firstSeen: e.at, lastSeen: e.at, lastRole: e.role, minimised: false, ignored: false,
        tier: e.tier, foldKey: e.foldKey });
      return;
    }
    const count = setCount ?? old.count + (e.n ?? 1);
    if (count !== old.count) old.lastSeen = e.at;
    Object.assign(old, { count, lastRole: e.role ?? old.lastRole, message: e.message, tier: e.tier });
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

  async removeAll(category?: ErrorCategory, tier?: ErrorTier): Promise<number> {
    let n = 0;
    for (const [k, r] of this.rows) {
      if ((!category || r.category === category) && (!tier || r.tier === tier)) { this.rows.delete(k); n++; }
    }
    return n;
  }

  async purgeBefore(iso: string): Promise<void> {
    for (const [k, r] of this.rows) if (r.lastSeen < iso) this.rows.delete(k);
  }
}
