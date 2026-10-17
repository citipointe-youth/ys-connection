// Supabase reconcile runs (migration 0036). Ids only, never names. Keeps the newest KEEP_RUNS rows.
import type { SqlClient } from './client';
import { toIso } from './client';
import { KEEP_RUNS, type IReconcileRunRepository, type ReconcileRun } from '../interfaces/reconcile-run.repository';

export class SupabaseReconcileRunRepository implements IReconcileRunRepository {
  constructor(private readonly sql: SqlClient) {}
  async save(r: ReconcileRun): Promise<void> {
    await this.sql`insert into reconcile_runs (id, ran_at, import_id, ok, checks, items)
      values (${r.id}, ${r.ranAt}, ${r.importId}, ${r.ok}, ${this.sql.json(r.checks as any)}, ${this.sql.json(r.items as any)})`;
    await this.sql`delete from reconcile_runs where id not in (select id from reconcile_runs order by ran_at desc limit ${KEEP_RUNS})`;
  }
  async latest(): Promise<ReconcileRun | null> {
    const [x] = await this.sql`select * from reconcile_runs order by ran_at desc limit 1`;
    return x ? { id: x.id, ranAt: toIso(x.ran_at), importId: x.import_id ?? null, ok: x.ok, checks: x.checks, items: x.items } : null;
  }
}
