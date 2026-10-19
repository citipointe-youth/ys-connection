import type { AuthedRequest } from '../http/types';
import type { NewYouthService } from '../../services/new-youth.service';

export function makeNewYouthController(deps: { newYouth: NewYouthService }) {
  return {
    async send(req: AuthedRequest) {
      return deps.newYouth.send(req.ctx, req.body);
    },
    // T10 admin 'Unsent new people' (admin:manage, checked in the service).
    async unsentList(req: AuthedRequest) {
      return deps.newYouth.unsentList(req.ctx);
    },
    async unsentRetry(req: AuthedRequest) {
      return deps.newYouth.unsentRetry(req.ctx, req.params['id']!, req.body);
    },
    async unsentDelete(req: AuthedRequest) {
      return deps.newYouth.unsentDelete(req.ctx, req.params['id']!);
    },
  };
}
