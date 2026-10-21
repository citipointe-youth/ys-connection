// Supabase admin Error log (T3, Part 1 fold). Table from migrations 0019 + 0035 (RLS on; the API is the superuser).
// ponytail: two serverless instances can race the fold update and make two rows for one burst; accepted (FYI, collapsed).
import type { SqlClient } from './client';
import { toIso } from './client';
import { FOLD_WINDOW_MS, type ErrorCategory, type ErrorLogEntry, type ErrorLogRow, type IErrorLogRepository } from '../interfaces/error-log.repository';
import type { ErrorTier } from '../../services/error-log-text';

type Row = Record<string, any>;
const toRow = (r: Row): ErrorLogRow => ({ id: r.id, category: r.category, code: r.code, route: r.route, status: r.status ?? null,
  message: r.message, count: r.count, firstSeen: toIso(r.first_seen), lastSeen: toIso(r.last_seen), lastRole: r.last_role ?? null,
  minimised: r.minimised, ignored: r.ignored, tier: r.tier, foldKey: r.fold_key ?? null });

export class SupabaseErrorLogRepository implements IErrorLogRepository {
  constructor(private readonly sql: SqlClient) {}

  async record(e: ErrorLogEntry, setCount?: number): Promise<void> {
    if (setCount === 0) { await this.sql`delete from error_log where id = ${e.id}`; return; }
    const n = e.n ?? 1;
    if (setCount === undefined && e.foldKey) {
      const hit = await this.sql`
        update error_log set count = count + ${n}::int, last_seen = greatest(last_seen, ${e.at}::timestamptz),
          last_role = coalesce(${e.role}::text, last_role)
        where id = (select id from error_log where fold_key = ${e.foldKey} and not ignored
                      and last_seen > ${e.at}::timestamptz - ${FOLD_WINDOW_MS}::int * interval '1 millisecond'
                    order by last_seen desc limit 1)
        returning id`;
      if (hit.length) return;
    }
    const set = setCount ?? null;
    await this.sql`
      insert into error_log (id, category, code, route, status, message, count, first_seen, last_seen, last_role, tier, fold_key)
      values (${e.id}, ${e.category}, ${e.code}, ${e.route}, ${e.status}, ${e.message}, ${set ?? n}, ${e.at}, ${e.at}, ${e.role},
              ${e.tier}, ${e.foldKey})
      on conflict (id) do update set
        count = coalesce(${set}::int, error_log.count + ${n}::int),
        last_seen = case when coalesce(${set}::int, error_log.count + ${n}::int) = error_log.count then error_log.last_seen
                         else excluded.last_seen end,
        last_role = coalesce(excluded.last_role, error_log.last_role),
        message = excluded.message,
        tier = excluded.tier`;
  }

  async list(): Promise<ErrorLogRow[]> {
    return (await this.sql`select * from error_log order by last_seen desc limit 500`).map(toRow);
  }

  async setFlags(id: string, flags: { minimised?: boolean; ignored?: boolean }): Promise<boolean> {
    const r = await this.sql`
      update error_log set minimised = coalesce(${flags.minimised ?? null}::boolean, minimised),
        ignored = coalesce(${flags.ignored ?? null}::boolean, ignored)
      where id = ${id} returning id`;
    return r.length > 0;
  }

  async remove(id: string): Promise<boolean> {
    return (await this.sql`delete from error_log where id = ${id} returning id`).length > 0;
  }

  async removeAll(category?: ErrorCategory, tier?: ErrorTier): Promise<number> {
    const c = category ?? null, t = tier ?? null;
    const r = await this.sql`delete from error_log where (${c}::text is null or category = ${c}::text)
      and (${t}::text is null or tier = ${t}::text) returning id`;
    return r.length;
  }

  async purgeBefore(iso: string): Promise<void> {
    await this.sql`delete from error_log where last_seen < ${iso}`;
  }
}
