import { z } from 'zod';
import { generateId } from '../utils/id';
import { assertCan, can } from './access-control';
import type { INoticeRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import { NOTICE_QUADS, type Notice } from '../core/entities/notice';
import type { Actor } from '../core/entities/user';
import { NotFoundError, ModuleDisabledError } from '../core/errors/app-error';

export const NOTICE_HISTORY_DAYS = 30;

const SendSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1000),
  recipients: z.array(z.enum(NOTICE_QUADS)).min(1).max(4),
});

export interface NoticeService {
  /** Last 30 days, newest first. admin/director: all. A quad login: only those addressed to its quad. Anyone else: none. */
  list(actor: Actor): Promise<Notice[]>;
  send(actor: Actor, input: unknown): Promise<Notice>;
  remove(actor: Actor, id: string): Promise<void>;
}

export function makeNoticeService(repo: INoticeRepository, settingsRepo?: ISettingsRepository, now: () => Date = () => new Date()): NoticeService {
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
      return repo.save({
        id: generateId(), title: d.title, body: d.body, recipients: [...new Set(d.recipients)],
        senderId: actor.id, senderName: actor.displayName, createdAt: now().toISOString(),
      });
    },
    async remove(actor, id) {
      await assertOn();
      assertCan(actor, 'notice:write');
      if (!(await repo.delete(id))) throw new NotFoundError('Notice not found');
    },
  };
}
