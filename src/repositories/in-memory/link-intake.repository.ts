// X19 (T4): in-memory intake plans (memory/json persistence; never saved to disk). Plain detail (only the Supabase repo
// encrypts). Deep-clones on every read and write.
import type { ILinkIntakeRepository, IntakeDateRow, IntakeMode, IntakePushMeta, IntakeRowLite, IntakeRowWrite }
  from '../interfaces/link-intake.repository';

const clone = <T>(v: T): T => structuredClone(v);
const k2 = (mode: IntakeMode, date: string) => `${mode}|${date}`;

export class InMemoryLinkIntakeRepository implements ILinkIntakeRepository {
  private d = new Map<string, IntakeDateRow>();
  private r = new Map<string, { lite: IntakeRowLite; detail: unknown }>(); // mode|date|key
  private viewed: string | null = null;
  constructor(private clock: () => Date = () => new Date()) {}

  async replace(mode: IntakeMode, m: IntakePushMeta, rows: IntakeRowWrite[]) {
    const prev = this.d.get(k2(mode, m.date));
    if (prev?.takenAt && Date.parse(m.takenAt) <= Date.parse(prev.takenAt)) return { applied: false, rows: 0 };
    const now = this.clock().toISOString();
    for (const k of [...this.r.keys()]) if (k.startsWith(k2(mode, m.date) + '|')) this.r.delete(k);
    for (const x of rows) {
      const { detail, ...rest } = x;
      const done = x.status === 'done';
      this.r.set(`${k2(mode, m.date)}|${x.key}`, { lite: { ...clone(rest), mode, date: m.date, takenAt: m.takenAt, doneAt: done ? now : null },
        detail: done ? null : clone(detail) });
    }
    this.d.set(k2(mode, m.date), { mode, date: m.date, takenAt: m.takenAt, consoleId: m.consoleId, rowCount: rows.length, cut: m.cut,
      inputsFrom: m.inputs?.from ?? null, inputsAt: m.inputs?.at ?? null, refreshAskedAt: null });
    return { applied: true, rows: rows.length };
  }
  async dates(mode?: IntakeMode) {
    return clone([...this.d.values()].filter((x) => !mode || x.mode === mode).sort((a, b) => b.date.localeCompare(a.date)));
  }
  async rows(mode: IntakeMode, date?: string) {
    return clone([...this.r.values()].map((x) => x.lite).filter((x) => x.mode === mode && (!date || x.date === date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key)));
  }
  async detail(mode: IntakeMode, date: string, key: string) {
    const x = this.r.get(`${k2(mode, date)}|${key}`);
    return x ? { row: clone(x.lite), detail: clone(x.detail), unreadable: false } : null;
  }
  async askRefresh(mode: IntakeMode, date: string) {
    const now = this.clock();
    const prev = this.d.get(k2(mode, date));
    if (prev?.refreshAskedAt && now.getTime() - Date.parse(prev.refreshAskedAt) < 60_000) return false;
    this.d.set(k2(mode, date), prev ? { ...prev, refreshAskedAt: now.toISOString() } : { mode, date, takenAt: null, consoleId: null,
      rowCount: 0, cut: false, inputsFrom: null, inputsAt: null, refreshAskedAt: now.toISOString() });
    return true;
  }
  async markViewed() { this.viewed = this.clock().toISOString(); }
  async viewedAt() { return this.viewed; }
  async purge(before: string) {
    for (const [k, x] of this.d) if (x.date < before) this.d.delete(k);
    for (const [k, x] of this.r) if (x.lite.date < before) this.r.delete(k);
  }
  async clear() { this.d.clear(); this.r.clear(); this.viewed = null; }
}
