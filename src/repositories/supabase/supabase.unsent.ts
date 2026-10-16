// Supabase New person unsent queue (T10). Table from migration 0023; request claims from 0032 (RLS on; the API is the superuser).
import type { SqlClient } from './client';
import { toIso } from './client';
import type { IUnsentRepository, UnsentRow } from '../interfaces/unsent.repository';

export class SupabaseUnsentRepository implements IUnsentRepository {
  constructor(private readonly sql: SqlClient) {}
  async save(r: UnsentRow): Promise<void> {
    await this.sql`
      insert into newperson_unsent (id, reason, payload, created_at, updated_at)
      values (${r.id}, ${r.reason}, ${r.payload}, ${r.createdAt}, ${r.updatedAt})
      on conflict (id) do update set reason = excluded.reason, payload = excluded.payload, updated_at = excluded.updated_at`;
  }
  async list(): Promise<UnsentRow[]> {
    return (await this.sql`select * from newperson_unsent order by created_at`).map((r: Record<string, any>) => ({
      id: r.id, reason: r.reason, payload: r.payload, createdAt: toIso(r.created_at), updatedAt: toIso(r.updated_at) }));
  }
  async remove(id: string): Promise<boolean> {
    return (await this.sql`delete from newperson_unsent where id = ${id} returning id`).length > 0;
  }
  async purgeBefore(iso: string): Promise<void> {
    await this.sql`delete from newperson_unsent where created_at < ${iso}`;
    await this.sql`delete from newperson_requests where created_at < ${iso}`;
  }
  // S-5/D4: table from migration 0032. The insert is the lock: a second claim of the same id loses the conflict.
  async claimRequest(id: string, by: string): Promise<{ fresh: boolean; result: unknown | null }> {
    const ins = await this.sql`insert into newperson_requests (id, created_by) values (${id}, ${by}) on conflict (id) do nothing returning id`;
    if (ins.length) return { fresh: true, result: null };
    const [r] = await this.sql`select result from newperson_requests where id = ${id}`;
    return { fresh: false, result: (r as Record<string, any> | undefined)?.result ?? null };
  }
  async finishRequest(id: string, result: unknown | null): Promise<void> {
    if (result === null) await this.sql`delete from newperson_requests where id = ${id}`;
    else await this.sql`update newperson_requests set result = ${this.sql.json(result as Parameters<typeof this.sql.json>[0])} where id = ${id}`;
  }
}
