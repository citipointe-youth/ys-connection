import type { HttpRequest } from '../http/types';
import type { NewYouthService } from '../../services/new-youth.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeNewYouthController(deps: { newYouth: NewYouthService }) {
  return {
    async send(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.newYouth.send(req.ctx, req.body);
    },
    // T10 admin 'Unsent new people' (admin:manage, checked in the service).
    async unsentList(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.newYouth.unsentList(req.ctx);
    },
    async unsentRetry(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.newYouth.unsentRetry(req.ctx, req.params['id']!, req.body);
    },
    async unsentDelete(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.newYouth.unsentDelete(req.ctx, req.params['id']!);
    },
  };
}
