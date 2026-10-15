import type { HttpRequest } from '../http/types';
import type { NoticeService } from '../../services/notice.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeNoticeController(deps: { notice: NoticeService }) {
  return {
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.notice.list(req.ctx);
    },
    async send(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.notice.send(req.ctx, req.body);
    },
    async remove(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      await deps.notice.remove(req.ctx, req.params['id']!);
      return { ok: true };
    },
    async pushConfig(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.notice.pushConfig(req.ctx);
    },
    async subscribe(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.notice.subscribe(req.ctx, req.body);
    },
    async unsubscribe(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.notice.unsubscribe(req.ctx, req.body);
    },
  };
}
