// Supabase admin Error log (T3). Table from migration 0019 (RLS on; the API is the superuser).
import type { SqlClient } from './client';
import { toIso } from './client';
import type { ErrorCategory, ErrorLogEntry, ErrorLogRow, IErrorLogRepository } from '../interfaces/error-log.repository';

type Row = Record<string, any>;
const toRow = (r: Row): ErrorLogRow => ({ id: r.id, category: r.category, code: r.code, route: r.route, status: r.status ?? null,
  message: r.message, count: r.count, firstSeen: toIso(r.first_seen), lastSeen: toIso(r.last_seen), lastRole: r.last_role ?? null,
  minimised: r.minimised, ignored: r.ignored });

export class SupabaseErrorLogRepository implements IErrorLogRepository {
  constructor(private readonly sql: SqlClient) {}

  async record(e: ErrorLogEntry, setCount?: number): Promise<void> {
    const set = setCount ?? null;
    const n = e.n ?? 1;
    await this.sql`
      insert into error_log (id, category, code, route, status, message, count, first_seen, last_seen, last_role)
      values (${e.id}, ${e.category}, ${e.code}, ${e.route}, ${e.status}, ${e.message}, ${set ?? n}, ${e.at}, ${e.at}, ${e.role})
      on conflict (id) do update set
        count = coalesce(${set}::int, error_log.count + ${n}::int),
        last_seen = case when coalesce(${set}::int, error_log.count + ${n}::int) = error_log.count then error_log.last_seen
                         else excluded.last_seen end,
        last_role = coalesce(excluded.last_role, error_log.last_role),
        message = excluded.message`;
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

  async removeAll(category?: ErrorCategory): Promise<number> {
    const r = category
      ? await this.sql`delete from error_log where category = ${category} returning id`
      : await this.sql`delete from error_log returning id`;
    return r.length;
  }

  async purgeBefore(iso: string): Promise<void> {
    await this.sql`delete from error_log where last_seen < ${iso}`;
  }
}
