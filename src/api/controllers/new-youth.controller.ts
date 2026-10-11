import type { HttpRequest } from '../http/types';
import type { NewYouthService } from '../../services/new-youth.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeNewYouthController(deps: { newYouth: NewYouthService }) {
  return {
    async send(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.newYouth.send(req.ctx, req.body);
    },
  };
}
