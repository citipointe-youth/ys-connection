// In-memory New person unsent queue (T10). Memory mode is dev/test only, no json persistence.
import type { IUnsentRepository, UnsentRow } from '../interfaces/unsent.repository';

export class InMemoryUnsentRepository implements IUnsentRepository {
  readonly rows = new Map<string, UnsentRow>();
  async save(row: UnsentRow): Promise<void> {
    const old = this.rows.get(row.id);
    this.rows.set(row.id, { ...row, createdAt: old?.createdAt ?? row.createdAt });
  }
  async list(): Promise<UnsentRow[]> {
    return [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => ({ ...r }));
  }
  async remove(id: string): Promise<boolean> { return this.rows.delete(id); }
  async purgeBefore(iso: string): Promise<void> {
    for (const [k, r] of this.rows) if (r.createdAt < iso) this.rows.delete(k);
  }
}
