import type { SqlClient } from './client';
import { toIso } from './client';
import type { INoticeRepository, INoticePushRepository } from '../interfaces/entity-repositories';
import type { Notice, NoticePushSub, NoticeQuad } from '../../core/entities/notice';

function toNotice(row: Record<string, unknown>): Notice {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    body: row['body'] as string,
    recipients: (row['recipients'] as NoticeQuad[]) ?? [],
    senderId: row['sender_id'] as string,
    senderName: (row['sender_name'] as string | null) ?? '',
    createdAt: toIso(row['created_at']),
  };
}

export class SupabaseNoticeRepository implements INoticeRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> { /* table created by migration 0028 */ }

  async findAll(): Promise<Notice[]> {
    return (await this.sql`select * from notices order by created_at desc`).map(toNotice);
  }
  async findSince(iso: string): Promise<Notice[]> {
    return (await this.sql`select * from notices where created_at >= ${iso} order by created_at desc`).map(toNotice);
  }
  async findById(id: string): Promise<Notice | null> {
    const rows = await this.sql`select * from notices where id = ${id}`;
    return rows[0] ? toNotice(rows[0]) : null;
  }
  async save(n: Notice): Promise<Notice> {
    const rows = await this.sql`
      insert into notices (id, title, body, recipients, sender_id, sender_name, created_at)
      values (${n.id}, ${n.title}, ${n.body}, ${n.recipients as unknown as string[]}, ${n.senderId}, ${n.senderName}, ${n.createdAt})
      on conflict (id) do update set title = excluded.title, body = excluded.body, recipients = excluded.recipients
      returning *`;
    return toNotice(rows[0]!);
  }
  async delete(id: string): Promise<boolean> {
    return (await this.sql`delete from notices where id = ${id} returning id`).length > 0;
  }
}

function toSub(row: Record<string, unknown>): NoticePushSub {
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    endpoint: row['endpoint'] as string,
    p256dh: row['p256dh'] as string,
    auth: row['auth'] as string,
    createdAt: toIso(row['created_at']),
  };
}

export class SupabaseNoticePushRepository implements INoticePushRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> { /* table created by migration 0029 */ }

  async findAll(): Promise<NoticePushSub[]> {
    return (await this.sql`select * from notice_push_subscriptions`).map(toSub);
  }
  async findById(id: string): Promise<NoticePushSub | null> {
    const rows = await this.sql`select * from notice_push_subscriptions where id = ${id}`;
    return rows[0] ? toSub(rows[0]) : null;
  }
  async save(s: NoticePushSub): Promise<NoticePushSub> {
    const rows = await this.sql`
      insert into notice_push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
      values (${s.id}, ${s.userId}, ${s.endpoint}, ${s.p256dh}, ${s.auth}, ${s.createdAt})
      on conflict (id) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
      returning *`;
    return toSub(rows[0]!);
  }
  async delete(id: string): Promise<boolean> {
    return (await this.sql`delete from notice_push_subscriptions where id = ${id} returning id`).length > 0;
  }
}
