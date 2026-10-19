import type { AuthedRequest } from '../http/types';
import type { LifegroupStatsService } from '../../services/lifegroup-stats.service';

export function makeLifegroupStatsController(deps: { lifegroupStats: LifegroupStatsService }) {
  return {
    async get(req: AuthedRequest) {
      return deps.lifegroupStats.get(req.ctx);
    },
  };
}
