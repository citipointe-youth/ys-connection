import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { z } from 'zod';
import { generateId } from '../utils/id';
import { assertCan, can, receivesNoticePush } from './access-control';
import type { INoticePushRepository, INoticeRepository, ISettingsRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import { NOTICE_QUADS, type Notice } from '../core/entities/notice';
import type { Actor } from '../core/entities/user';
import { AppError, NotFoundError, ModuleDisabledError } from '../core/errors/app-error';
import type { ErrorLogService } from './error-log.service';

export const NOTICE_HISTORY_DAYS = 30;

const SendSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1000),
  recipients: z.array(z.enum(NOTICE_QUADS)).min(1).max(4),
});

const SubscribeSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
const UnsubscribeSchema = z.object({ endpoint: z.string().min(1).max(1000) });

export interface Vapid { publicKey: string; privateKey: string; subject: string }
/** Sends one push. Throws on failure; a dead endpoint throws with statusCode 404/410 (web-push's WebPushError). */
export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, vapid: Vapid) => Promise<unknown>;
const webPushSender: PushSender = (sub, payload, v) =>
  webpush.sendNotification(sub, payload, { vapidDetails: v, TTL: 3600, timeout: 5000 });

export interface NoticePushDeps {
  subs: INoticePushRepository;
  users: Pick<IUserRepository, 'findAll'>;
  errorLog?: Pick<ErrorLogService, 'record'>;
  sender?: PushSender;
  env?: Record<string, string | undefined>;
}

/** VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT; any one unset = alerts silently off. */
function readVapid(env: Record<string, string | undefined>): Vapid | null {
  const publicKey = env['VAPID_PUBLIC_KEY']?.trim(), privateKey = env['VAPID_PRIVATE_KEY']?.trim(), subject = env['VAPID_SUBJECT']?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}
const subId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

/** The notification text: first line of the notice (its title), ~120 chars. Nothing else from the notice goes out. */
export function pushPayload(n: Pick<Notice, 'title'>): string {
  const line = n.title.replace(/\s+/g, ' ').trim();
  return JSON.stringify({ title: 'New notice', body: line.length > 120 ? line.slice(0, 119) + '…' : line, screen: 'notices' });
}

export interface NoticeService {
  /** Last 30 days, newest first. admin/director: all. A quad login: only those addressed to its quad. Anyone else: none. */
  list(actor: Actor): Promise<Notice[]>;
  send(actor: Actor, input: unknown): Promise<Notice>;
  remove(actor: Actor, id: string): Promise<void>;
  /** `publicKey` null = VAPID env not set (alerts aren't set up yet). */
  pushConfig(actor: Actor): Promise<{ publicKey: string | null }>;
  subscribe(actor: Actor, input: unknown): Promise<{ ok: true }>;
  unsubscribe(actor: Actor, input: unknown): Promise<{ ok: true }>;
}

export function makeNoticeService(
  repo: INoticeRepository, settingsRepo?: ISettingsRepository, now: () => Date = () => new Date(), push?: NoticePushDeps,
): NoticeService {
  const env = push?.env ?? process.env;
  const sender = push?.sender ?? webPushSender;

  // After the insert. Never throws: a failed alert must not fail the send. Logs a fixed code only, never a notice or person.
  async function pushNotice(n: Notice): Promise<void> {
    const v = readVapid(env);
    if (!push || !v) return;
    let failed = 0;
    try {
      const users = new Map((await push.users.findAll()).map((u) => [u.id, u]));
      const targets = (await push.subs.findAll()).filter((s) => { const u = users.get(s.userId); return !!u && receivesNoticePush(u, n.recipients); });
      const payload = pushPayload(n);
      await Promise.all(targets.map(async (s) => {
        try {
          await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, v);
        } catch (e) {
          const status = (e as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) await push.subs.delete(s.id).catch(() => { failed++; });
          else failed++;
        }
      }));
    } catch { failed++; }
    if (failed) await push.errorLog?.record({ category: 'server', code: 'PUSH_FAILED', route: 'POST /notices', count: failed });
  }

  // Off by default: every route answers 404 (ModuleDisabledError) and stored notices are kept.
  async function assertOn(): Promise<void> {
    if (!settingsRepo) return;
    if ((await settingsRepo.getSettings()).ministryConfig.modules.notices !== 'on') throw new ModuleDisabledError('Notices');
  }
  return {
    async list(actor) {
      await assertOn();
      const since = new Date(now().getTime() - NOTICE_HISTORY_DAYS * 86_400_000).toISOString();
      const all = await repo.findSince(since);
      if (can(actor, 'notice:write')) return all;
      if (actor.role === 'quad' && actor.quad) return all.filter((n) => n.recipients.includes(actor.quad as never));
      return [];
    },
    async send(actor, input) {
      await assertOn();
      assertCan(actor, 'notice:write');
      const d = SendSchema.parse(input);
      const saved = await repo.save({
        id: generateId(), title: d.title, body: d.body, recipients: [...new Set(d.recipients)],
        senderId: actor.id, senderName: actor.displayName, createdAt: now().toISOString(),
      });
      await pushNotice(saved);
      return saved;
    },
    async remove(actor, id) {
      await assertOn();
      assertCan(actor, 'notice:write');
      if (!(await repo.delete(id))) throw new NotFoundError('Notice not found');
    },
    async pushConfig(actor) {
      await assertOn();
      assertCan(actor, 'notice:alerts');
      return { publicKey: (push && readVapid(env)?.publicKey) || null };
    },
    async subscribe(actor, input) {
      await assertOn();
      assertCan(actor, 'notice:alerts');
      if (!push || !readVapid(env)) throw new AppError('PUSH_OFF', "Alerts aren't set up yet.", 503);
      const d = SubscribeSchema.parse(input);
      // Same device, new login: the row moves to whoever subscribed last.
      await push.subs.save({ id: subId(d.endpoint), userId: actor.id, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth, createdAt: now().toISOString() });
      return { ok: true };
    },
    // Not module-gated: turning alerts off always works.
    async unsubscribe(actor, input) {
      assertCan(actor, 'notice:alerts');
      const d = UnsubscribeSchema.parse(input);
      const id = subId(d.endpoint);
      if (push && (await push.subs.findById(id))?.userId === actor.id) await push.subs.delete(id);
      return { ok: true };
    },
  };
}
