// ID Checks on Postgres (migration 0053, spec 2026-10-30 §7.1-7.2). `content` is encrypted here and only here
// (AAD id_check_entries:content:<id>), like the phone fields in supabase.students.ts.
import type { SqlClient } from './client';
import { toIso } from './client';
import type { IIdCheckRepository } from '../interfaces/entity-repositories';
import type { IdCheckEntry, IdCheckTick } from '../../core/entities/id-check';
import { maybeEncrypt, maybeDecrypt } from '../../utils/field-crypto';

const aad = (id: string) => 'id_check_entries:content:' + id;
const ymd = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

export function toRow(e: IdCheckEntry) {
  return {
    id: e.id, leader_id: e.leaderId, leader_name: e.leaderName, kind: e.kind, held_on: e.heldOn, finished: e.finished,
    author_id: e.authorId, author_name: e.authorName, content: maybeEncrypt(JSON.stringify(e.content), aad(e.id))!,
    created_at: e.createdAt, updated_at: e.updatedAt,
  };
}

export function fromRow(r: Record<string, unknown>): IdCheckEntry {
  const id = r['id'] as string;
  return {
    id,
    leaderId: (r['leader_id'] as string | null) ?? null,
    leaderName: (r['leader_name'] as string | null) ?? '',
    kind: r['kind'] as IdCheckEntry['kind'],
    heldOn: ymd(r['held_on']),
    finished: !!r['finished'],
    authorId: r['author_id'] as string,
    authorName: (r['author_name'] as string | null) ?? '',
    content: JSON.parse(maybeDecrypt(r['content'] as string, aad(id))!) as IdCheckEntry['content'],
    createdAt: toIso(r['created_at']),
    updatedAt: toIso(r['updated_at']),
  };
}

export class SupabaseIdCheckRepository implements IIdCheckRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> { /* tables created by migration 0053 */ }

  async findEntry(id: string): Promise<IdCheckEntry | null> {
    const [r] = await this.sql`select * from id_check_entries where id = ${id}`;
    return r ? fromRow(r) : null;
  }
  async listByLeader(leaderId: string): Promise<IdCheckEntry[]> {
    return (await this.sql`select * from id_check_entries where leader_id = ${leaderId}
      order by held_on desc, updated_at desc`).map(fromRow);
  }
  async lastFinished(leaderIds: string[]): Promise<Map<string, string>> {
    if (!leaderIds.length) return new Map();
    const rows = await this.sql`select leader_id, max(held_on)::text as last from id_check_entries
      where leader_id = any(${leaderIds}::uuid[]) and kind = 'check' and finished group by leader_id`;
    return new Map(rows.map((r) => [r['leader_id'] as string, r['last'] as string]));
  }
  async inProgress(leaderIds: string[]): Promise<Map<string, { id: string; authorId: string; authorName: string }>> {
    if (!leaderIds.length) return new Map();
    const rows = await this.sql`select distinct on (leader_id) leader_id, id, author_id, author_name from id_check_entries
      where leader_id = any(${leaderIds}::uuid[]) and kind = 'check' and not finished
      order by leader_id, held_on desc, updated_at desc`;
    return new Map(rows.map((r) => [r['leader_id'] as string,
      { id: r['id'] as string, authorId: r['author_id'] as string, authorName: (r['author_name'] as string) ?? '' }]));
  }
  async upsert(e: IdCheckEntry): Promise<IdCheckEntry> {
    const w = toRow(e);
    const [r] = await this.sql`
      insert into id_check_entries (id, leader_id, leader_name, kind, held_on, finished, author_id, author_name, content,
        created_at, updated_at)
      values (${w.id}, ${w.leader_id}, ${w.leader_name}, ${w.kind}, ${w.held_on}, ${w.finished}, ${w.author_id},
        ${w.author_name}, ${w.content}, ${w.created_at}, ${w.updated_at})
      on conflict (id) do update set leader_id = excluded.leader_id, leader_name = excluded.leader_name,
        held_on = excluded.held_on, finished = id_check_entries.finished or excluded.finished,
        content = excluded.content, updated_at = excluded.updated_at
      returning *`;
    return fromRow(r!);
  }
  async deleteEntry(id: string): Promise<void> {
    await this.sql`delete from id_check_entries where id = ${id}`;
  }

  async ticks(): Promise<IdCheckTick[]> {
    return (await this.sql`select leader_id, user_id from id_check_access`)
      .map((r) => ({ leaderId: r['leader_id'] as string, userId: r['user_id'] as string }));
  }
  async ticksForLeader(leaderId: string): Promise<IdCheckTick[]> {
    return (await this.sql`select leader_id, user_id from id_check_access where leader_id = ${leaderId}`)
      .map((r) => ({ leaderId: r['leader_id'] as string, userId: r['user_id'] as string }));
  }
  async setTicks(userId: string, leaderIds: string[], on: boolean): Promise<void> {
    if (!leaderIds.length) return;
    if (on) {
      await this.sql`insert into id_check_access (leader_id, user_id)
        select l, ${userId}::uuid from unnest(${leaderIds}::uuid[]) as l on conflict do nothing`;
    } else {
      await this.sql`delete from id_check_access where user_id = ${userId} and leader_id = any(${leaderIds}::uuid[])`;
    }
  }

  async archivedGroups(): Promise<{ name: string; count: number; lastOn: string }[]> {
    const rows = await this.sql`select leader_name, count(*)::int as n, max(held_on)::text as last
      from id_check_entries where leader_id is null group by leader_name order by leader_name`;
    return rows.map((r) => ({ name: r['leader_name'] as string, count: r['n'] as number, lastOn: r['last'] as string }));
  }
  async deleteArchived(name: string): Promise<number> {
    return (await this.sql`delete from id_check_entries where leader_id is null and leader_name = ${name} returning id`).length;
  }
  async attachArchived(name: string, leaderId: string, leaderName: string): Promise<number> {
    return (await this.sql`update id_check_entries set leader_id = ${leaderId}, leader_name = ${leaderName}
      where leader_id is null and leader_name = ${name} returning id`).length;
  }
}
