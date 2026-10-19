import type { AuthedRequest } from '../http/types';
import type { OverviewService } from '../../services/overview.service';

export function makeOverviewController(deps: { overview: OverviewService }) {
  return {
    async stats(req: AuthedRequest) {
      return deps.overview.getStats(req.ctx);
    },
  };
}
