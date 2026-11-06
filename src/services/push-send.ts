// Web push, shared by notice alerts and leader alerts (spec 5.2 b; moved out of notice.service.ts, behaviour unchanged).
import webpush from 'web-push';
import type { NoticePushSub } from '../core/entities/notice';
import type { INoticePushRepository } from '../repositories/interfaces/entity-repositories';

export interface Vapid { publicKey: string; privateKey: string; subject: string }
/** Sends one push. Throws on failure; a dead endpoint throws with statusCode 404/410 (web-push's WebPushError). */
export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, vapid: Vapid) => Promise<unknown>;
export const webPushSender: PushSender = (sub, payload, v) =>
  webpush.sendNotification(sub, payload, { vapidDetails: v, TTL: 3600, timeout: 5000 });

/** VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT; any one unset = alerts silently off. */
export function readVapid(env: Record<string, string | undefined>): Vapid | null {
  const publicKey = env['VAPID_PUBLIC_KEY']?.trim(), privateKey = env['VAPID_PRIVATE_KEY']?.trim(), subject = env['VAPID_SUBJECT']?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

type Sub = Pick<NoticePushSub, 'id' | 'endpoint' | 'p256dh' | 'auth'>;

/** One payload to every sub, in parallel. A 404/410 deletes the dead sub and is not a failure. Never throws. */
export async function sendToSubs(subs: Sub[], payload: string,
  d: { sender: PushSender; vapid: Vapid; repo: Pick<INoticePushRepository, 'delete'> }): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await d.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, d.vapid);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) await d.repo.delete(s.id).catch(() => { failed++; });
      else failed++;
    }
  }));
  return { sent, failed };
}
