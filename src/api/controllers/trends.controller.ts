import type { HttpRequest } from '../http/types';
import type { TrendsService } from '../../services/trends.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeTrendsController(deps: { trends: TrendsService }) {
  return {
    async get(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.trends.get(req.ctx);
    },
  };
}
