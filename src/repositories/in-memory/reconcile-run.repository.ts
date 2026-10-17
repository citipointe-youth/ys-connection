// In-memory reconcile runs (Part 2). Dev/test only.
import { KEEP_RUNS, type IReconcileRunRepository, type ReconcileRun } from '../interfaces/reconcile-run.repository';

export class InMemoryReconcileRunRepository implements IReconcileRunRepository {
  private runs: ReconcileRun[] = [];
  async save(r: ReconcileRun): Promise<void> {
    this.runs = [...this.runs, structuredClone(r)].sort((a, b) => b.ranAt.localeCompare(a.ranAt)).slice(0, KEEP_RUNS);
  }
  async latest(): Promise<ReconcileRun | null> { return this.runs[0] ? structuredClone(this.runs[0]) : null; }
  size(): number { return this.runs.length; }
}
