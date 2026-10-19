import type { AuthedRequest } from '../http/types';
import type { TrendsService } from '../../services/trends.service';

export function makeTrendsController(deps: { trends: TrendsService }) {
  return {
    async get(req: AuthedRequest) {
      return deps.trends.get(req.ctx);
    },
  };
}
