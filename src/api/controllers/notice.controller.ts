import type { AuthedRequest } from '../http/types';
import type { NoticeService } from '../../services/notice.service';

export function makeNoticeController(deps: { notice: NoticeService }) {
  return {
    async list(req: AuthedRequest) {
      return deps.notice.list(req.ctx);
    },
    async send(req: AuthedRequest) {
      return deps.notice.send(req.ctx, req.body);
    },
    async remove(req: AuthedRequest) {
      await deps.notice.remove(req.ctx, req.params['id']!);
      return { ok: true };
    },
    async pushConfig(req: AuthedRequest) {
      return deps.notice.pushConfig(req.ctx);
    },
    async subscribe(req: AuthedRequest) {
      return deps.notice.subscribe(req.ctx, req.body);
    },
    async unsubscribe(req: AuthedRequest) {
      return deps.notice.unsubscribe(req.ctx, req.body);
    },
  };
}
