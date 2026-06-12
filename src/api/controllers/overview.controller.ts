import type { HttpRequest } from '../http/types';
import type { OverviewService } from '../../services/overview.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeOverviewController(deps: { overview: OverviewService }) {
  return {
    async stats(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.overview.getStats(req.ctx);
    },
  };
}
