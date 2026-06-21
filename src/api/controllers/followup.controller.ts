import type { HttpRequest } from '../http/types';
import type { FollowupService } from '../../services/followup.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeFollowupController(deps: { followup: FollowupService }) {
  return {
    async leaderFollowup(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.followup.leaderFollowup(req.ctx, req.params['leaderId']!);
    },
  };
}
