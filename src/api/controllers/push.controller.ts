import { z } from 'zod';
import type { HttpRequest } from '../http/types';
import type { PushService } from '../../services/push.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

const sendSchema = z.object({
  target: z.union([
    z.object({ type: z.literal('all') }),
    z.object({ type: z.literal('quad'), quad: z.string().min(1) }),
    z.object({
      type: z.literal('grade'),
      grade: z.number().int().min(7).max(12),
      gender: z.enum(['male', 'female']),
    }),
  ]),
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
});

export function makePushController(deps: { push: PushService }) {
  return {
    getVapidKey(_req: HttpRequest) {
      return Promise.resolve({ publicKey: deps.push.getVapidPublicKey() });
    },

    async subscribe(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const parsed = subscribeSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(parsed.error.message);
      await deps.push.subscribe(req.ctx, parsed.data.endpoint, parsed.data.p256dh, parsed.data.auth);
      return { ok: true };
    },

    async unsubscribe(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const parsed = z.object({ endpoint: z.string().url() }).safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(parsed.error.message);
      await deps.push.unsubscribe(req.ctx, parsed.data.endpoint);
      return { ok: true };
    },

    async send(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(parsed.error.message);
      const result = await deps.push.send(req.ctx, parsed.data.target, parsed.data.title, parsed.data.message);
      return result;
    },

    async getNotifications(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.push.getNotificationsForUser(req.ctx);
    },

    async deleteNotification(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing notification id');
      await deps.push.deleteNotification(req.ctx, id);
      return { ok: true };
    },

    async dismissNotification(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing notification id');
      await deps.push.dismissNotification(req.ctx, id);
      return { ok: true };
    },
  };
}
