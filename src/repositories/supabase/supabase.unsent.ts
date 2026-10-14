// Supabase New person unsent queue (T10). Table from migration 0023 (RLS on; the API is the superuser).
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
  }
}
